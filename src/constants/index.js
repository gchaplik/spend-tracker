export const DEFAULT_CATS = ["Groceries","Dining","Transport","Utilities","Entertainment","Health","Shopping","Fuel","Other"];

export const COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16","#6b7280","#f97316"];

export const CADENCES = [
  {v:"once",l:"One-time"},{v:"weekly",l:"Weekly"},{v:"biweekly",l:"Bi-weekly (every 2 weeks)"},
  {v:"every15",l:"Every 15 days"},{v:"monthly",l:"Monthly"},{v:"bimonthly",l:"Every 2 months"},
  {v:"quarterly",l:"Quarterly"},{v:"annually",l:"Annually"},
];

export const NAV_ITEMS = [
  { k:"dashboard", l:"Home",           icon:"⊞", desc:"Overview of your finances — spending, income, budgets and upcoming bills at a glance.", alwaysShow:true },
  { k:"insights",  l:"Insights",       icon:"◈", desc:"Ask questions about your data and get charts and answers powered by a local AI model.", alwaysShow:true },
  { k:"bills",     l:"Bills",          icon:"◷", desc:"Track recurring bills, mark them paid each month, and see what's still outstanding." },
  { k:"goals",     l:"Goals",          icon:"◎", desc:"Set savings goals with a target amount and date, and track your progress over time." },
  { k:"networth",  l:"Net Worth",      icon:"◈", desc:"Track accounts, assets and liabilities to see your overall financial position." },
  { k:"stocks",    l:"Stocks",         icon:"◉", desc:"Monitor your stock and ETF holdings with live prices in CAD and USD." },
  { k:"expected",  l:"Expected Income",icon:"◑", desc:"Schedule future income payments and mark them received when they land." },
  { k:"history",   l:"History",        icon:"≡",  desc:"Browse, search and bulk-edit all your past transactions." },
  { k:"vacations", l:"Vacations",      icon:"◷", desc:"Budget and track spending for trips separately from your main expenses." },
  { k:"categories",l:"Categories",     icon:"▦", desc:"Define spending categories and set monthly budget caps with progress alerts." },
  { k:"manual",    l:"Add Expense",    icon:"+", desc:"Log a one-off or recurring expense directly into your transaction history." },
  { k:"income",    l:"Add Income",     icon:"+", desc:"Record a one-off or recurring income entry." },
  { k:"import",       l:"CSV Import",       icon:"⇩", desc:"Import transactions from a bank CSV export — auto-maps columns and detects duplicates." },
  { k:"reports",      l:"Reports",          icon:"▤", desc:"Export monthly summaries, annual tax reports, and filtered transaction CSVs." },
  { k:"cashflow",     l:"Cash Flow",        icon:"◌", desc:"90-day forecast of your balance based on bills, income, and spending patterns." },
  { k:"debt",         l:"Debt Tracker",     icon:"◐", desc:"Track loans, credit cards, and mortgage — payoff strategies and total interest." },
  { k:"subscriptions",l:"Subscriptions",    icon:"↻", desc:"Track recurring subscriptions, detect them from history, and see your total monthly cost." },
  { k:"tax",          l:"Tax Tracker",      icon:"◧", desc:"Tag deductible transactions, track RRSP contributions, and generate a tax year summary." },
  { k:"retirement",   l:"Retirement",       icon:"◎", desc:"RRSP/TFSA planner with compound growth projections and retirement gap analysis." },
  { k:"calendar",     l:"Calendar",         icon:"▦", desc:"Monthly calendar view of bills, income, goals, and vacations." },
  { k:"wishlist",     l:"Wishlist",         icon:"◈", desc:"Track planned purchases and see when you can afford them based on your savings rate." },
  { k:"mortgage",     l:"Mortgage",         icon:"◑", desc:"Amortization calculator with extra payment simulator and payoff scenarios." },
  { k:"household",    l:"Household",        icon:"⌂", desc:"Manage household members, split expenses, and track who owes who." },
  { k:"folder",       l:"Folder Sync",      icon:"▤", desc:"Point the app at a local folder of receipts and import them all at once." },
  { k:"upload",       l:"Upload Receipts",  icon:"↑", desc:"Upload individual receipt photos or PDFs and extract the details automatically." },
  { k:"settings",     l:"Settings",         icon:"⚙", desc:"Configure your name, Ollama model, and developer options.", isBottom:true },
  { k:"toolcoverage", l:"Tool Coverage",    icon:"⊛", desc:"Dev: compare all data points against available Jarvis tools.", isBottom:true, devOnly:true },
];

export const TODAY = () => new Date().toISOString().split("T")[0];

export const DEFAULT_SETTINGS = {
  name:"", ollamaUrl:"http://localhost:11434", ollamaModel:"phi3:mini",
  devMode:false, globalChatModel:"deepseek", jarvisVoice:true,
  darkMode:false, colorBlindMode:"none", largeTransactionAlert:500,
  alertsEnabled:null,
  discreteMode:false,
  deepseekModel:"deepseek-r1:8b"
};
