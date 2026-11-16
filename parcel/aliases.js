// Reviewed address relationships only. Source records are still fetched live.
export const ADDRESS_ALIASES = Object.freeze([
  {
    address: "50 FITCH ST",
    parcelId: 23699,
    confidence: "high",
    note: "A reviewed city planning document identifies this as another address for the parcel.",
    evidenceUrls: [
      "https://www.arcgis.com/home/item.html?id=4d4bfb8138d24eac8d83e4b3201d86fa",
    ],
  },
  {
    address: "179 CROWN ST",
    parcelId: 13791,
    confidence: "medium",
    note: "Historical Yale listing places Cask Republic at 179 Crown St. A live city permit for Cask Republic (B-21-02020) is attached to this parcel, listed as 181 Crown St. Confirm the entrance and parcel before relying on this historical address link.",
    evidenceUrls: [
      "https://summerstudy.yale.edu/sites/default/files/guide_to_new_haven_restaurants_bars.pdf",
      "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    ],
  },
]);
