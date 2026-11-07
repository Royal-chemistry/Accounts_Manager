// Business types, and the categories and stock units each one starts with.

export const COMMON_EXPENSE = ["Rent", "Electricity", "Internet & phone", "Transport", "Repairs", "Bank charges", "Taxes & fees", "Office supplies", "Professional fees", "Other"];
export const COMMON_INCOME = ["Sales", "Service income", "Other income"];

export const BUSINESS_TYPES = [
  { id: "retail", label: "Retail shop", expense: ["Stock purchase", "Packaging", "Shop maintenance"], income: ["Counter sales", "Online sales"], units: ["pcs", "box", "kg", "g", "L", "pack", "dozen"], stock: true },
  { id: "restaurant", label: "Restaurant or café", expense: ["Raw materials", "Gas", "Kitchen supplies", "Delivery commission", "Cleaning"], income: ["Dine-in", "Takeaway", "Delivery"], units: ["kg", "g", "L", "ml", "pcs", "plate", "crate"], stock: true },
  { id: "services", label: "Services", expense: ["Software", "Travel", "Subcontractors", "Marketing"], income: ["Service fees", "Retainers", "Consulting"], units: ["hrs", "job", "pcs"], stock: false },
  { id: "manufacturing", label: "Manufacturing", expense: ["Raw materials", "Machinery maintenance", "Power & fuel", "Job work", "Freight"], income: ["Product sales", "Job work", "Scrap sales"], units: ["kg", "ton", "pcs", "L", "m", "roll", "box"], stock: true },
  { id: "construction", label: "Construction", expense: ["Cement & materials", "Labour contractors", "Equipment hire", "Site expenses", "Fuel"], income: ["Contract billing", "Retention received"], units: ["bag", "ton", "cft", "sqft", "m", "load", "pcs"], stock: true },
  { id: "agency", label: "Agency or manpower", expense: ["Uniforms & kit", "Staff accommodation", "Recruitment", "Site expenses", "Insurance"], income: ["Manpower billing", "Service charges"], units: ["pcs", "set", "pair"], stock: false },
  { id: "clinic", label: "Clinic", expense: ["Medicines", "Consumables", "Lab charges", "Equipment maintenance", "Biomedical waste"], income: ["Consultation", "Procedures", "Pharmacy", "Lab"], units: ["strip", "bottle", "box", "pcs", "ml", "vial"], stock: true },
  { id: "trading", label: "Trading or wholesale", expense: ["Stock purchase", "Freight", "Loading & unloading", "Godown rent", "Commission"], income: ["Wholesale sales", "Commission income"], units: ["pcs", "box", "carton", "kg", "quintal", "ton", "bag"], stock: true },
  { id: "other", label: "Other", expense: [], income: [], units: ["pcs", "box", "kg", "L"], stock: false },
];

const unique = (list) => [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];

export const typeById = (id) => BUSINESS_TYPES.find((t) => t.id === id) || BUSINESS_TYPES.at(-1);

/** The categories and units a business type starts with. */
export function presetFor(typeId) {
  const t = typeById(typeId);
  return {
    expense: unique([...t.expense, ...COMMON_EXPENSE]),
    income: unique([...t.income, ...COMMON_INCOME]),
    units: unique(t.units),
    stock: t.stock,
  };
}

/** Adds a preset's categories to existing ones. Nothing is ever removed. */
export function mergeCategories(current = {}, preset) {
  return {
    expense: unique([...(current.expense || []), ...preset.expense]),
    income: unique([...(current.income || []), ...preset.income]),
    units: unique([...(current.units || []), ...preset.units]),
    stock: unique(current.stock || []),
  };
}

// Entries that move money but aren't income or expense, so they stay out of profit.
export const NON_PROFIT_CATEGORIES = new Set(["GST payment", "PF/ESI remittance", "Owner drawings", "Balance adjustment"]);
