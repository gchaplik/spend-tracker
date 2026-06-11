const fetchUsdCad = (dateStr) => {
  const endpoint = dateStr >= today()
    ? "https://api.frankfurter.app/latest?from=USD&to=CAD"
    : `https://api.frankfurter.app/${dateStr}?from=USD&to=CAD`;
  return fetch(endpoint).then(r => r.json()).then(d => {
    const rate = d?.rates?.CAD;
    if (!rate) throw new Error("Rate unavailable");
    return rate;
  });
};

export { fetchUsdCad };
