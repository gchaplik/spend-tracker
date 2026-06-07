import * as transactions from "../dal/transactions.js";
import * as bills from "../dal/bills.js";
import * as vacations from "../dal/vacations.js";
import * as holdings from "../dal/holdings.js";
import * as expected from "../dal/expected.js";
import * as settings from "../dal/settings.js";

export const getFullData = () => {
  const allSettings = settings.getAllSettings();
  return {
    txns: transactions.getAll(),
    bills: bills.getAllBills(),
    billPayments: bills.getPayments(),
    vacations: vacations.getAll(),
    vacationTxns: vacations.getAllTxns(),
    holdings: holdings.getAll(),
    accounts: holdings.getAccounts(),
    accountHistory: holdings.getHistory(),
    expected: expected.getAll(),
    catBudgets: settings.getCatBudgets(),
    goals: settings.getGoals(),
    cats: allSettings.cats ?? null,
    settings: allSettings.settings ?? null,
    schema: allSettings.schema ?? null,
    favourites: allSettings.favourites ?? [],
    receiptFPs: allSettings.receiptFPs ?? [],
    insightMessages: allSettings.insightMessages ?? [],
    insightWidgets: allSettings.insightWidgets ?? [],
  };
};

// Smart merge: detect which keys changed and call the right DAL methods
export const mergeData = (patch) => {
  if (patch.txns !== undefined) transactions.replaceAll(patch.txns);
  if (patch.bills !== undefined) bills.replaceAllBills(patch.bills);
  if (patch.billPayments !== undefined) bills.replaceAllPayments(patch.billPayments);
  if (patch.vacations !== undefined) vacations.replaceAll(patch.vacations);
  if (patch.vacationTxns !== undefined) vacations.replaceAllTxns(patch.vacationTxns);
  if (patch.holdings !== undefined) holdings.replaceAllHoldings(patch.holdings);
  if (patch.accounts !== undefined) holdings.replaceAllAccounts(patch.accounts);
  if (patch.accountHistory !== undefined) holdings.replaceAllHistory(patch.accountHistory);
  if (patch.expected !== undefined) expected.replaceAll(patch.expected);
  if (patch.catBudgets !== undefined) settings.replaceCatBudgets(patch.catBudgets);
  if (patch.goals !== undefined) settings.replaceAllGoals(patch.goals);
  // JSON-blob keys stored in settings table
  for (const key of ["cats", "settings", "schema", "favourites", "receiptFPs", "insightMessages", "insightWidgets"]) {
    if (patch[key] !== undefined) settings.setSetting(key, patch[key]);
  }
};
