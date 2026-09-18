import type { CategoryGroup } from "./types";

export interface GroupDef {
  id: CategoryGroup;
  label: string;
  emoji: string;
  /** Overpass tag filters, e.g. ["shop"] (any value) or ["amenity=cafe"]. */
  osm: string[];
  /** Google Places (New) `includedTypes`. */
  google: string[];
}

/**
 * The groups double as the filter chips in the UI and as the query definition
 * for both providers, so a chip can never drift from what is actually fetched.
 */
export const GROUPS: GroupDef[] = [
  {
    id: "food",
    label: "Food & drink",
    emoji: "🍽️",
    osm: [
      "amenity=restaurant",
      "amenity=cafe",
      "amenity=fast_food",
      "amenity=bar",
      "amenity=pub",
      "amenity=ice_cream",
      "amenity=biergarten",
      "amenity=food_court",
      "shop=bakery",
      "shop=butcher",
      "shop=coffee",
      "shop=confectionery",
      "shop=deli",
      "shop=greengrocer",
      "shop=pastry",
      "shop=seafood",
    ],
    google: [
      "restaurant",
      "cafe",
      "bakery",
      "bar",
      "meal_takeaway",
      "meal_delivery",
      "coffee_shop",
      "ice_cream_shop",
    ],
  },
  {
    id: "retail",
    label: "Shops",
    emoji: "🛍️",
    osm: ["shop", "amenity=marketplace"],
    google: [
      "store",
      "clothing_store",
      "furniture_store",
      "hardware_store",
      "book_store",
      "jewelry_store",
      "pet_store",
      "florist",
      "convenience_store",
      "grocery_store",
    ],
  },
  {
    id: "beauty",
    label: "Beauty & wellness",
    emoji: "💈",
    osm: [
      "shop=hairdresser",
      "shop=beauty",
      "shop=massage",
      "shop=tattoo",
      "shop=nail",
      "shop=cosmetics",
      "leisure=spa",
      "amenity=spa",
    ],
    google: ["beauty_salon", "hair_salon", "nail_salon", "spa", "barber_shop"],
  },
  {
    id: "health",
    label: "Health",
    emoji: "🩺",
    osm: [
      "healthcare",
      "amenity=doctors",
      "amenity=dentist",
      "amenity=pharmacy",
      "amenity=clinic",
      "amenity=veterinary",
      "shop=optician",
      "shop=hearing_aids",
      "shop=medical_supply",
    ],
    google: [
      "doctor",
      "dentist",
      "pharmacy",
      "physiotherapist",
      "veterinary_care",
      "medical_lab",
      "chiropractor",
    ],
  },
  {
    id: "services",
    label: "Local services",
    emoji: "🧰",
    osm: [
      "shop=laundry",
      "shop=dry_cleaning",
      "shop=travel_agency",
      "shop=funeral_directors",
      "shop=copyshop",
      "shop=pet_grooming",
      "shop=photo",
      "amenity=childcare",
      "amenity=driving_school",
      "amenity=animal_boarding",
      "office=estate_agent",
      "office=employment_agency",
    ],
    google: [
      "laundry",
      "dry_cleaner",
      "travel_agency",
      "funeral_home",
      "child_care_agency",
      "moving_company",
      "storage",
      "real_estate_agency",
    ],
  },
  {
    id: "trades",
    label: "Trades & repair",
    emoji: "🔨",
    osm: [
      "craft",
      "shop=hardware",
      "shop=doityourself",
      "shop=trade",
      "shop=electronics_repair",
      "shop=locksmith",
      "shop=shoe_repair",
    ],
    google: [
      "plumber",
      "electrician",
      "roofing_contractor",
      "painter",
      "general_contractor",
      "locksmith",
      "moving_company",
    ],
  },
  {
    id: "professional",
    label: "Professional",
    emoji: "💼",
    osm: ["office"],
    google: [
      "accounting",
      "lawyer",
      "insurance_agency",
      "consultant",
      "corporate_office",
      "finance",
    ],
  },
  {
    id: "auto",
    label: "Automotive",
    emoji: "🚗",
    osm: [
      "shop=car",
      "shop=car_repair",
      "shop=car_parts",
      "shop=tyres",
      "shop=motorcycle",
      "shop=bicycle",
      "amenity=car_wash",
      "amenity=car_rental",
      "amenity=fuel",
    ],
    google: [
      "car_repair",
      "car_dealer",
      "car_wash",
      "car_rental",
      "gas_station",
      "auto_parts_store",
    ],
  },
  {
    id: "lodging",
    label: "Stays",
    emoji: "🏨",
    osm: [
      "tourism=hotel",
      "tourism=guest_house",
      "tourism=motel",
      "tourism=hostel",
      "tourism=apartment",
      "tourism=chalet",
      "tourism=camp_site",
    ],
    google: ["hotel", "motel", "guest_house", "bed_and_breakfast", "campground"],
  },
  {
    id: "leisure",
    label: "Leisure & fitness",
    emoji: "🎯",
    osm: [
      "leisure=fitness_centre",
      "leisure=sports_centre",
      "leisure=bowling_alley",
      "leisure=escape_game",
      "leisure=dance",
      "leisure=golf_course",
      "amenity=cinema",
      "amenity=nightclub",
      "amenity=theatre",
      "tourism=museum",
      "tourism=attraction",
    ],
    google: [
      "gym",
      "fitness_center",
      "movie_theater",
      "night_club",
      "bowling_alley",
      "tourist_attraction",
      "museum",
    ],
  },
];

export const GROUP_IDS = GROUPS.map((g) => g.id);

export function groupLabel(id: CategoryGroup): string {
  return GROUPS.find((g) => g.id === id)?.label ?? "Other";
}

export function groupEmoji(id: CategoryGroup): string {
  return GROUPS.find((g) => g.id === id)?.emoji ?? "📍";
}

/** Parse the `groups` query param into a validated list; empty means "all". */
export function parseGroups(raw: string | null): CategoryGroup[] {
  if (!raw) return [];
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as CategoryGroup[];
  const valid = wanted.filter((g) => GROUP_IDS.includes(g));
  // "everything selected" is the same query as "nothing selected", and the
  // unfiltered query is much cheaper upstream.
  return valid.length === GROUP_IDS.length ? [] : valid;
}
