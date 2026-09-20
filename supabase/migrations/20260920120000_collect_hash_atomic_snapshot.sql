-- =====================================================================================
-- Збір $HASH: атомарний знімок стану після збору + дрібне виправлення гонки.
--
-- Проблема (клієнт): після /api/farm/harvest фронт оновлював лише баланси, а
-- user_gpus[].last_harvest_at / lifetime_hash_generated / is_dead лишались у
-- глобальному стейті СТАРИМИ. Лічильник "накопичено" на Фермі рахується з
-- last_harvest_at, тож при поверненні на вкладку "Ферма" (компонент монтується
-- наново) він знову показував уже зібрану суму, а повторний клік нараховував
-- лише мізерний приріст з моменту попереднього збору.
--
-- Тут:
--   1) collect_hash(p_user_id) — ОДНА транзакція: harvest_user_hash (рахує на
--      боці Postgres, тримає FOR UPDATE на профілі і рядках user_gpus) + читання
--      балансів і user_gpus у тій самій транзакції. Клієнт отримує все, з чого
--      він рахує лічильник, з відповіді, а не з другого запиту до БД.
--   2) harvest_user_hash: v_now береться ПІСЛЯ отримання блокування. Раніше
--      clock_timestamp() обчислювався у DECLARE, ще до FOR UPDATE: два паралельні
--      виклики могли взяти лок у порядку, відмінному від порядку v_now, і
--      "пізніший" за часом виклик відкочував last_harvest_at назад, а наступний
--      збір нараховував цей проміжок удруге. Плюс last_harvest_at не рухається назад.
--
-- Чому clock_timestamp(), а не NOW(): NOW() — це початок транзакції, тобто момент
-- ДО очікування на лок; після очікування він уже застарілий і давав би саме той
-- відкат last_harvest_at назад, що описаний вище.
--
-- Формула незмінна: per-GPU elapsed (не більше 12 год) * hash_per_second * amount,
-- обмежено lifecycle-капом рядка. Клієнт НІЧОГО не передає, крім p_user_id
-- (який роут бере з перевіреного initData).
-- =====================================================================================

create or replace function public.harvest_user_hash(p_user_id uuid)
returns numeric(18, 6)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now                    timestamptz;
    v_total_harvested        numeric(18, 6) := 0;
    v_elapsed_seconds         numeric;
    v_row_harvested            numeric(18, 6);
    v_row_cap                  numeric(18, 6);
    v_row_headroom              numeric(18, 6);
    v_gpu                      record;
    v_referrer_id              uuid;
    v_lifetime_hash            numeric(18, 6);
    v_threshold_hash           constant numeric(18, 6) := 100;
    v_max_unclaimed_seconds  constant numeric           := 43200;   -- 12 годин
    -- lib/constants/economy.ts GPU_LIFECYCLE_MULTIPLIER / HASH_TO_TON_RATE —
    -- тримати синхронізовано вручну.
    v_lifecycle_multiplier   constant numeric           := 1.25;
    v_hash_to_ton_rate        constant numeric           := 0.00001;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- Час беремо лише тепер, коли лок на профіль утримується: порядок v_now
    -- збігається з порядком отримання блокування.
    v_now := clock_timestamp();

    for v_gpu in
        select ug.id, ug.amount, ug.last_harvest_at, ug.lifetime_hash_generated, ug.is_dead,
               gt.hash_per_second, gt.cost_ton
        from public.user_gpus ug
        join public.gpu_templates gt on gt.level = ug.gpu_level
        where ug.user_id = p_user_id
          and ug.amount > 0
        order by ug.id
        for update of ug
    loop
        if v_gpu.is_dead then
            continue;
        end if;

        v_elapsed_seconds := least(
            greatest(extract(epoch from (v_now - v_gpu.last_harvest_at)), 0),
            v_max_unclaimed_seconds
        );
        v_row_harvested := round(v_elapsed_seconds * v_gpu.hash_per_second * v_gpu.amount, 6);

        v_row_cap := (v_gpu.cost_ton * v_lifecycle_multiplier * v_gpu.amount) / v_hash_to_ton_rate;
        v_row_headroom := greatest(v_row_cap - v_gpu.lifetime_hash_generated, 0);

        if v_row_harvested >= v_row_headroom then
            v_row_harvested := v_row_headroom;
            update public.user_gpus
                set last_harvest_at = greatest(last_harvest_at, v_now),
                    lifetime_hash_generated = lifetime_hash_generated + v_row_harvested,
                    is_dead = true
                where id = v_gpu.id;
        else
            update public.user_gpus
                set last_harvest_at = greatest(last_harvest_at, v_now),
                    lifetime_hash_generated = lifetime_hash_generated + v_row_harvested
                where id = v_gpu.id;
        end if;

        v_total_harvested := v_total_harvested + v_row_harvested;
    end loop;

    if v_total_harvested > 0 then
        update public.profiles as pr
            set hash_balance = pr.hash_balance + v_total_harvested,
                lifetime_hash_generated = pr.lifetime_hash_generated + v_total_harvested,
                harvest_count = pr.harvest_count + 1
            where pr.id = p_user_id
            returning pr.lifetime_hash_generated into v_lifetime_hash;

        -- Лише прапорець "реферал пройшов перший цикл" — без грошового
        -- нарахування referrer'у (як і в 20260905140000_...).
        if v_referrer_id is not null and v_lifetime_hash >= v_threshold_hash then
            update public.referrals
                set has_reached_threshold = true
                where referrer_id = v_referrer_id
                  and referee_id = p_user_id
                  and has_reached_threshold = false;
        end if;
    end if;

    return v_total_harvested;
end;
$$;

-- ------------------------------------------------------------------------------------
-- collect_hash: harvest + знімок стану в одній транзакції.
--
-- Повертає jsonb:
--   success            — завжди true (помилки йдуть як exception -> HTTP 4xx/5xx у роуті)
--   collected          — скільки $HASH нараховано цим викликом
--   new_hash_balance   — profiles.hash_balance ПІСЛЯ нарахування
--   game_balance, withdrawable_balance — решта балансів з того ж знімка
--   last_collected_at  — момент збору (max last_harvest_at серед живих карток);
--                        null, якщо живих карток немає (збирати нічого)
--   user_gpus          — усі рядки user_gpus користувача після збору: саме з
--                        них клієнт рахує лічильник (last_harvest_at,
--                        lifetime_hash_generated, is_dead)
--   server_time        — годинник БД в момент відповіді, для синхронізації
--                        клієнтського годинника з тим, що писав last_harvest_at
--
-- Повторний виклик (подвійний клік) чекає на FOR UPDATE у harvest_user_hash і
-- отримує collected ~ 0 із коректним знімком, а не подвійне нарахування.
-- ------------------------------------------------------------------------------------
create or replace function public.collect_hash(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_collected        numeric(18, 6);
    v_hash_balance     numeric(18, 6);
    v_game_balance     numeric(18, 6);
    v_withdrawable     numeric(18, 6);
    v_last_collected   timestamptz;
    v_user_gpus        jsonb;
begin
    -- Кидає P0002, якщо профілю немає. Локи (профіль + user_gpus) тримаються
    -- до кінця цієї транзакції, тож читання нижче бачить узгоджений стан.
    v_collected := public.harvest_user_hash(p_user_id);

    select pr.hash_balance, pr.game_balance, pr.withdrawable_balance
        into v_hash_balance, v_game_balance, v_withdrawable
        from public.profiles pr
        where pr.id = p_user_id;

    select max(ug.last_harvest_at)
        into v_last_collected
        from public.user_gpus ug
        where ug.user_id = p_user_id
          and ug.amount > 0
          and not ug.is_dead;

    select coalesce(jsonb_agg(to_jsonb(ug) order by ug.gpu_level), '[]'::jsonb)
        into v_user_gpus
        from public.user_gpus ug
        where ug.user_id = p_user_id;

    return jsonb_build_object(
        'success', true,
        'collected', v_collected,
        'new_hash_balance', v_hash_balance,
        'game_balance', v_game_balance,
        'withdrawable_balance', v_withdrawable,
        'last_collected_at', v_last_collected,
        'user_gpus', v_user_gpus,
        'server_time', clock_timestamp()
    );
end;
$$;

revoke all on function public.collect_hash(uuid) from public, anon, authenticated;
grant execute on function public.collect_hash(uuid) to service_role;
