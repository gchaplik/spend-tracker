import { getFullData } from "./dataService.js";

export const execQuery = (queryStr) => {
  const data = getFullData();
  // eslint-disable-next-line no-new-func
  const fn = new Function("data", `"use strict"; return (${queryStr})`);
  return fn(data);
};
