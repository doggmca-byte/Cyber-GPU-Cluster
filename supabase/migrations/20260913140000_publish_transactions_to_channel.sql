-- =====================================================================================
-- Дублювання поповнень і виплат у публічний канал @CGPU_transactions.
--
-- Публікує не той код, що створює транзакцію, а окремий крон: рядків, які
-- створюють поповнення, кілька (крон сканування скарбниці, опортуністичний
-- скан при відкритті застосунку, ручна кнопка "Перевірити оплату", санація
-- в адмінці), і чіпляти відправку до кожного — це гарантовано десь її
-- забути. Натомість джерелом правди лишається сама таблиця: усе, що
-- завершилось і ще не опубліковане, рано чи пізно поїде в канал.
--
-- Такий підхід заодно вирішує три речі безкоштовно: історію (усі старі
-- транзакції просто мають channel_published_at = null), стійкість (збій
-- Telegram не втрачає допис — наступний прогін підбере), і захист від
-- дублів (позначка ставиться лише після успішної відправки).
-- =====================================================================================

alter table public.transactions
    add column if not exists channel_published_at timestamptz;

-- Частковий індекс: планувальнику потрібні лише неопубліковані рядки, а їх
-- у сталому режимі одиниці на тлі десятків тисяч транзакцій.
create index if not exists transactions_channel_unpublished_idx
    on public.transactions (created_at)
    where channel_published_at is null;

insert into public.system_jobs (name) values ('publish_transactions')
on conflict (name) do nothing;

-- ------------------------------------------------------------------------------------
-- Черга на публікацію: найстаріші першими, щоб історія в каналі читалась у
-- хронологічному порядку.
--
-- is_manual виключено навмисно: ручне нарахування адміністратора лежить у
-- transactions з type = 'deposit', але реальних грошей у скарбницю не
-- приносить. У каналі "транзакцій" такий рядок був би прямою неправдою.
-- ------------------------------------------------------------------------------------
create or replace function public.list_transactions_for_channel(p_limit integer default 10)
returns table (
    id          uuid,
    type        text,
    amount      numeric,
    fee         numeric,
    tx_hash     text,
    created_at  timestamptz,
    username    text,
    first_name  text
)
language sql
security definer
set search_path = public, pg_temp
as $$
    select t.id, t.type, t.amount, t.fee, t.tx_hash, t.created_at, p.username, p.first_name
        from public.transactions t
        join public.profiles p on p.id = t.user_id
        where t.channel_published_at is null
          and t.status = 'completed'
          and t.type in ('deposit', 'withdraw')
          and coalesce(t.is_manual, false) = false
        order by t.created_at
        limit greatest(p_limit, 1);
$$;

create or replace function public.mark_transaction_published(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.transactions
        set channel_published_at = now()
        where id = p_id and channel_published_at is null;
$$;

revoke all on function public.list_transactions_for_channel(integer) from public, anon, authenticated;
grant execute on function public.list_transactions_for_channel(integer) to service_role;

revoke all on function public.mark_transaction_published(uuid) from public, anon, authenticated;
grant execute on function public.mark_transaction_published(uuid) to service_role;
