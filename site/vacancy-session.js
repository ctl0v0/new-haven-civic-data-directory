const storageKey = "civic-fit-preview-addresses";
const launchKey = "civic-fit-preview-launch";

export function savedVacancyAddresses() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey));
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function saveVacancyAddresses(addresses) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(addresses)); } catch {}
}

export function consumeVacancyLaunch() {
  try {
    const launch = sessionStorage.getItem(launchKey);
    sessionStorage.removeItem(launchKey);
    return Boolean(launch);
  } catch { return false; }
}

function acceptPreviewLink() {
  const url = new URL(location.href);
  if (!url.hash.startsWith("#civic-fit=")) return;
  const seed = url.hash.slice("#civic-fit=".length);
  url.hash = "";
  history.replaceState(null, "", url);
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(seed)) return;
  try {
    const addresses = atob(seed.replaceAll("-", "+").replaceAll("_", "/")).split("\n");
    if (!addresses.length || addresses.length > 150 || addresses.some((address) => !address || address.length > 160)) return;
    saveVacancyAddresses(addresses);
    sessionStorage.setItem(launchKey, "1");
  } catch {}
}

acceptPreviewLink();
