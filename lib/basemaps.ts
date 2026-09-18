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

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

export interface BasemapOptions {
  /** Full tile URL template. Wins over everything else. */
  tileUrl?: string;
  tileAttribution?: string;
  /** A CARTO Basemaps key switches the street and dark styles to CARTO. */
  cartoApiKey?: string;
}

function cartoUrl(style: string, apiKey: string): string {
  return `https://basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}`;
}

/**
 * Build the basemap list.
 *
 * Three tiers, in order: an explicit tile URL for full control, a CARTO key for
 * their nicer styling, and otherwise OpenStreetMap's keyless service so the app
 * always has a working map with no configuration at all.
 */
export function buildBasemaps(options: BasemapOptions = {}): Basemap[] {
  const cartoKey = options.cartoApiKey?.trim();
  const explicit = options.tileUrl?.trim();

  const street = explicit || (cartoKey ? cartoUrl("rastertiles/voyager", cartoKey) : OSM_TILES);
  const attribution =
    options.tileAttribution?.trim() ||
    (explicit ? OSM_ATTRIBUTION : cartoKey ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION);

  // With CARTO available, dark is a real dark basemap rather than the street
  // tiles inverted in CSS — genuinely better, and it costs nothing extra.
  const dark: Basemap =
    !explicit && cartoKey
      ? {
          id: "dark",
          label: "Dark",
          url: cartoUrl("dark_all", cartoKey),
          attribution,
          maxZoom: 20,
        }
      : { id: "dark", label: "Dark", url: street, attribution, maxZoom: 19, darken: true };

  return [
    {
      id: "streets",
      label: "Streets",
      url: street,
      attribution,
      maxZoom: !explicit && cartoKey ? 20 : 19,
    },
    {
      id: "satellite",
      label: "Satellite",
      url: ESRI_IMAGERY,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      maxZoom: 19,
    },
    dark,
  ];
}
