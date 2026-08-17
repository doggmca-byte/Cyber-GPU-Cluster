/**
 * Канонічний словник — визначає TranslationDictionary type (через `typeof`).
 * Кожна інша мова типізується цим типом, тому відсутній/зайвий ключ ловиться
 * компілятором TypeScript ще до рантайму (див. lib/i18n/dictionaries/index.ts).
 */
const en = {
  common: {
    close: "Close",
    cancel: "Cancel",
    loading: "Loading...",
    retry: "Try again",
    comingSoon: "Coming soon",
    unknownError: "Unknown error",
    ton: "TON",
    hash: "HASH",
  },
  nav: {
    wallet: "Wallet",
    exchange: "Exchange",
    farm: "Farm",
    market: "Market",
    friends: "Friends",
  },
  noTelegram: {
    title: "Open via Telegram",
    description: "This app only works as a Telegram Mini App. Open the bot and tap the launch button.",
  },
  syncError: {
    title: "Sync error",
  },
  language: {
    pickerTitle: "Choose language",
  },
  rarity: {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    elite: "Elite",
    epic: "Epic",
    legendary: "Legendary",
    mythic: "Mythic",
    ancient: "Ancient",
    divine: "Divine",
    transcendent: "Transcendent",
  },
  farm: {
    dailyBonus: "Daily Bonus",
    totalPower: "Total power",
    hashPerHourSuffix: "HASH/h",
    accumulatedHash: "Accumulated $HASH",
    harvestButton: "Collect HASH",
    harvesting: "Collecting...",
    emptyGpuList: "You don't have any GPUs yet. Check out the Market to start mining.",
  },
  market: {
    gameBalance: "Game balance",
    owned: (amount: number, max: number) => `Owned ${amount}/${max}`,
    hashPerHour: (value: string) => `${value} HASH/h`,
    hashPerDay: (value: string) => `${value} HASH/day`,
    buy: (price: string) => `Buy · ${price} TON`,
    buying: "Buying...",
    limitReached: "Limit reached",
  },
  exchange: {
    hashToTon: {
      title: "$HASH → TON",
      rateNote: (min: string) => `Rate: 100,000 HASH = 1 TON · minimum ${min} HASH`,
      available: "Available",
      amountPlaceholder: (min: string) => `Minimum ${min}`,
      targetWithdrawable: "Withdrawable",
      targetGame: "Game",
      grossRow: "You'll get (gross)",
      feeRow: "Fee",
      netRow: "You'll receive",
      submit: "Exchange",
      submitting: "Exchanging...",
      success: (amount: string) => `Credited ${amount} TON`,
    },
    convertBack: {
      title: "Withdrawable → Game",
      rateNote: (min: string) => `Rate 1:1 · minimum ${min} TON`,
      withdrawableLabel: "Withdrawable",
      gameLabel: "Game",
      amountPlaceholder: (min: string) => `Minimum ${min}`,
      submit: "Transfer",
      submitting: "Transferring...",
      success: (amount: string) => `Transferred ${amount} TON to game balance`,
    },
  },
  friends: {
    invitedFriends: "Friends invited",
    totalEarned: "Total earned",
    pendingCommission: "Pending Commission",
    claimButton: "Claim all",
    claiming: "Claiming...",
    claimSuccess: (amount: string) => `Credited ${amount} TON`,
    rulesTitle: "How referral rewards work",
    ruleRevshare: (percent: string) => `${percent}% of every deposit your friend makes, forever`,
    ruleFirstHarvest: (bonus: string, threshold: string) =>
      `${bonus} TON one-time bonus once your friend mines ${threshold} HASH`,
    yourLink: "Your referral link",
    share: "Share",
    notConfigured: "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not configured.",
    shareMessage: "Join Cyber GPU Cluster and mine $HASH with me!",
  },
  wallet: {
    gameBalance: "Game Balance",
    withdrawable: "Withdrawable",
    quota: "Withdrawal quota",
    adsWatched: (watched: number, required: number) =>
      `Ads watched: ${watched}/${required} since last withdrawal`,
    depositButton: "Deposit",
    withdrawButton: "Withdraw",
    deposit: {
      title: "Top up Game Balance",
      notConfigured: "Deposits aren't set up yet (NEXT_PUBLIC_TREASURY_TON_ADDRESS is missing).",
      creditedTitle: "Credited!",
      creditedAmount: (amount: string) => `+${amount} TON to Game Balance`,
      done: "Done",
      chooseAmount: "Choose a top-up amount in TON",
      confirmInWallet: "Confirm in your wallet...",
      verifyingOnChain: "Verifying on the blockchain...",
      depositAmount: (amount: number) => `Top up ${amount} TON`,
      pickAmount: "Choose an amount",
      disclaimer: "Funds are credited only after the transaction is confirmed on the TON network.",
      timeoutError: "The transaction wasn't confirmed in time. Check your balance on this screen a bit later.",
    },
    withdraw: {
      title: "Withdraw TON",
      watchAdsPrompt: (watched: number, required: number) => `Watch ads: ${watched}/${required}`,
      balanceLabel: "Withdrawable Balance",
      quotaLabel: "Withdrawal quota",
      addressLabel: "Recipient TON wallet address",
      addressPlaceholder: "UQ... / EQ...",
      invalidAddress: "Invalid TON address.",
      amountLabel: "Amount",
      amountPlaceholder: "Amount in TON",
      requestRow: "Request",
      feeRow: (percent: string) => `Fee (${percent}%)`,
      netRow: "You'll receive",
      insufficientBalance: "Not enough funds in Withdrawable Balance.",
      insufficientQuota: "Withdrawal quota exceeded — watch more ads to unlock it.",
      submit: "Withdraw",
      submitting: "Submitting request...",
      success: (amount: string, addressShort: string) =>
        `Request created. You'll receive ${amount} TON at ${addressShort} (status: pending review).`,
    },
  },
  watchAd: {
    button: "Watch ad",
    loading: "Loading ad...",
  },
  errorPage: {
    title: "Something went wrong",
    description:
      "An unexpected error occurred. Try again — if it keeps happening, restart the app from Telegram.",
    retry: "Try again",
  },
};

// НАВМИСНО без `as const`: інакше рядкові властивості звужуються до
// літеральних типів (наприклад close: "Close" замість close: string), і
// кожен інший словник змушений мати ідентичні англійські значення — саме
// цю помилку зловив tsc при першому запуску перевірки словників.
export default en;
export type TranslationDictionary = typeof en;
