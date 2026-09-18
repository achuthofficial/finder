export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  /** Recolours these same tiles in CSS rather than fetching a second set. */
  darken?: boolean;
}

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/**
 * Hosts whose tiles need an account. The defaults must never use one: CARTO,
 * which this used originally, began answering anonymous requests with an
 * "API key required" tile, and the map broke on the deployed app while
 * everything else carried on working.
 */
export const KEYED_TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "cartocdn.com",
  "api.mapbox.com",
  "api.maptiler.com",
  "tiles.stadiamaps.com",
  "maps.googleapis.com",
  "dev.virtualearth.net",
  "api.os.uk",
  "api.tomtom.com",
  "maps.geoapify.com",
  "tile.thunderforest.com",
];

export function needsApiKey(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KEYED_TILE_HOSTS.some(
      (keyed) => host === keyed || host.endsWith(`.${keyed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Build the basemap list. The street tiles can be pointed at a commercial
 * provider through the environment; the dark style is those same tiles behind a
 * CSS filter, so switching styles costs no extra requests.
 */
export function buildBasemaps(
  tileUrl?: string,
  tileAttribution?: string,
): Basemap[] {
  const street = tileUrl || OSM_TILES;
  const attribution = tileAttribution || OSM_ATTRIBUTION;

  return [
    { id: "streets", label: "Streets", url: street, attribution, maxZoom: 19 },
    {
      id: "satellite",
      label: "Satellite",
      url: ESRI_IMAGERY,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      maxZoom: 19,
    },
    {
      id: "dark",
      label: "Dark",
      url: street,
      attribution,
      maxZoom: 19,
      darken: true,
    },
  ];
}
