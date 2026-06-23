#!/usr/bin/env node
/**
 * Seed delivery zones and courier records for both brands.
 *
 * Three courier tiers:
 *   1. safe_lagos     — Safe Logistics Lagos (20 Lagos LGAs, Lekki Ph1 pickup)
 *   2. nationwide     — Nationwide Courier (35 Nigerian states excl. Lagos)
 *   3. dhl_express    — DHL Express International (194 countries)
 *
 * Rates source:
 *   - Lagos LGAs     : Safe Wig Logistics Rate Card (Lekki Pickup)
 *   - Nigerian states: Wig Logistics Rate Card Nationwide
 *   - International  : DHL Global Wig Logistics Rates (+10% margin)
 *
 * Idempotent: couriers use ON CONFLICT (courier_key) DO UPDATE.
 *             zones use (name, courier_key) UPDATE-or-INSERT.
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const BRANDS = ["pixiegirl", "faitlynhair"];

// ── Helpers ────────────────────────────────────────────────

function rc(fee1, fee2, fee3, addon) {
  return JSON.stringify({
    tiers: [
      { label: "1–2 Wigs", min_qty: 1, max_qty: 2, fee_ngn: fee1 },
      { label: "3–4 Wigs", min_qty: 3, max_qty: 4, fee_ngn: fee2 },
      { label: "5–6 Wigs", min_qty: 5, max_qty: 6, fee_ngn: fee3 },
    ],
    add_on_per_2_ngn: addon,
  });
}

// ── Couriers ───────────────────────────────────────────────

const COURIERS = [
  {
    courier_key: "safe_lagos",
    display_name: "Safe Logistics – Lagos",
    description:
      "Local Lagos delivery. Pickup from Lekki Phase 1. Covers all 20 Lagos LGAs.",
    integration_type: "manual",
    serves_local: true,
    serves_nationwide: false,
    serves_international: false,
    service_countries: ["NG"],
    rate_card: JSON.stringify({
      note: "Per-LGA tiered rates stored on delivery_zones.rate_card",
    }),
    supports_pod: true,
    display_order: 1,
  },
  {
    courier_key: "nationwide",
    display_name: "Nationwide Courier",
    description:
      "Covers all Nigerian states except Lagos. Door-to-door delivery.",
    integration_type: "manual",
    serves_local: false,
    serves_nationwide: true,
    serves_international: false,
    service_countries: ["NG"],
    rate_card: JSON.stringify({
      note: "Per-state tiered rates stored on delivery_zones.rate_card",
    }),
    supports_pod: true,
    display_order: 2,
  },
  {
    courier_key: "dhl_express",
    display_name: "DHL Express International",
    description:
      "International express courier. Ships from Lagos to 194 countries. Rates include 10% safety margin.",
    integration_type: "partner_portal",
    serves_local: false,
    serves_nationwide: false,
    serves_international: true,
    service_countries: [], // populated from zone list
    rate_card: JSON.stringify({
      note: "Per-country tiered rates stored on delivery_zones.rate_card",
    }),
    supports_pod: false,
    display_order: 3,
  },
];

// ── Lagos LGA zones ────────────────────────────────────────
// Source: Safe Wig Logistics Rate Card (Lekki Pickup)

const LAGOS_LGAS = [
  ["Agege", "NG-LA-AGEGE", "Deep Mainland", 10000, 12000, 14000, 2000],
  ["Ajeromi-Ifelodun", "NG-LA-AJEROMI", "Deep Mainland", 10000, 12000, 14000, 2000],
  ["Alimosho", "NG-LA-ALIMOSHO", "Deep Mainland", 10000, 12000, 14000, 2000],
  ["Amuwo-Odofin", "NG-LA-AMUWO", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Apapa", "NG-LA-APAPA", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Badagry", "NG-LA-BADAGRY", "Extreme Outskirts", 12000, 14500, 17000, 2500],
  ["Epe", "NG-LA-EPE", "Extreme Outskirts", 12000, 14500, 17000, 2500],
  ["Eti-Osa (Lekki, VI, Ikoyi)", "NG-LA-ETI-OSA", "Immediate Proximity", 4500, 5500, 6500, 1000],
  ["Ibeju-Lekki", "NG-LA-IBEJU", "Island Extended", 7000, 8500, 10000, 1500],
  ["Ifako-Ijaiye", "NG-LA-IFAKO", "Deep Mainland", 10000, 12000, 14000, 2000],
  ["Ikeja", "NG-LA-IKEJA", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Ikorodu", "NG-LA-IKORODU", "Extreme Outskirts", 12000, 14500, 17000, 2500],
  ["Kosofe", "NG-LA-KOSOFE", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Lagos Island", "NG-LA-ISLAND", "Island", 4500, 5500, 6500, 1000],
  ["Lagos Mainland (Yaba)", "NG-LA-MAINLAND", "Close Mainland", 6500, 8000, 9500, 1500],
  ["Mushin", "NG-LA-MUSHIN", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Ojo", "NG-LA-OJO", "Deep Mainland", 10000, 12000, 14000, 2000],
  ["Oshodi-Isolo", "NG-LA-OSHODI", "Mid Mainland", 8000, 9500, 11000, 1500],
  ["Shomolu", "NG-LA-SHOMOLU", "Close Mainland", 6500, 8000, 9500, 1500],
  ["Surulere", "NG-LA-SURULERE", "Close Mainland", 6500, 8000, 9500, 1500],
];

// ── Nationwide state zones (excl. Lagos) ──────────────────
// Source: Wig Logistics Rate Card Nationwide

const NIGERIA_STATES = [
  // [name, iso3166_2_code, geo_zone, fee_1_2, fee_3_4, fee_5_6, addon]
  ["Abia", "NG-AB", "South-East", 7500, 10500, 13500, 3000],
  ["Adamawa", "NG-AD", "North-East", 8500, 12500, 16500, 4000],
  ["Akwa Ibom", "NG-AK", "South-South", 7500, 10500, 13500, 3000],
  ["Anambra", "NG-AN", "South-East", 7500, 10500, 13500, 3000],
  ["Bauchi", "NG-BA", "North-East", 8500, 12500, 16500, 4000],
  ["Bayelsa", "NG-BY", "South-South", 7500, 10500, 13500, 3000],
  ["Benue", "NG-BE", "North-Central", 6500, 9500, 12500, 3000],
  ["Borno", "NG-BO", "North-East", 8500, 12500, 16500, 4000],
  ["Cross River", "NG-CR", "South-South", 7500, 10500, 13500, 3000],
  ["Delta", "NG-DE", "South-South", 7500, 10500, 13500, 3000],
  ["Ebonyi", "NG-EB", "South-East", 7500, 10500, 13500, 3000],
  ["Edo", "NG-ED", "South-South", 7500, 10500, 13500, 3000],
  ["Ekiti", "NG-EK", "South-West", 4000, 5500, 7000, 1500],
  ["Enugu", "NG-EN", "South-East", 7500, 10500, 13500, 3000],
  ["FCT (Abuja)", "NG-FC", "North-Central", 6500, 9500, 12500, 3000],
  ["Gombe", "NG-GO", "North-East", 8500, 12500, 16500, 4000],
  ["Imo", "NG-IM", "South-East", 7500, 10500, 13500, 3000],
  ["Jigawa", "NG-JI", "North-West", 8500, 12500, 16500, 4000],
  ["Kaduna", "NG-KD", "North-West", 8500, 12500, 16500, 4000],
  ["Kano", "NG-KN", "North-West", 8500, 12500, 16500, 4000],
  ["Katsina", "NG-KT", "North-West", 8500, 12500, 16500, 4000],
  ["Kebbi", "NG-KE", "North-West", 8500, 12500, 16500, 4000],
  ["Kogi", "NG-KO", "North-Central", 6500, 9500, 12500, 3000],
  ["Kwara", "NG-KW", "North-Central", 6500, 9500, 12500, 3000],
  ["Nasarawa", "NG-NA", "North-Central", 6500, 9500, 12500, 3000],
  ["Niger", "NG-NI", "North-Central", 6500, 9500, 12500, 3000],
  ["Ogun", "NG-OG", "South-West", 4000, 5500, 7000, 1500],
  ["Ondo", "NG-ON", "South-West", 4000, 5500, 7000, 1500],
  ["Osun", "NG-OS", "South-West", 4000, 5500, 7000, 1500],
  ["Oyo", "NG-OY", "South-West", 4000, 5500, 7000, 1500],
  ["Plateau", "NG-PL", "North-Central", 6500, 9500, 12500, 3000],
  ["Rivers", "NG-RI", "South-South", 7500, 10500, 13500, 3000],
  ["Sokoto", "NG-SO", "North-West", 8500, 12500, 16500, 4000],
  ["Taraba", "NG-TA", "North-East", 8500, 12500, 16500, 4000],
  ["Yobe", "NG-YO", "North-East", 8500, 12500, 16500, 4000],
  ["Zamfara", "NG-ZA", "North-West", 8500, 12500, 16500, 4000],
];

// ── International DHL zones ────────────────────────────────
// Source: DHL Global Wig Logistics Rates (+10% margin)
// Format: [country_name, iso2_code, continent, dhl_zone, f1, f2, f3, addon]

const INTERNATIONAL = [
  // Africa
  ["Algeria", "DZ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Angola", "AO", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Benin", "BJ", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Botswana", "BW", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Burkina Faso", "BF", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Burundi", "BI", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Cabo Verde", "CV", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Cameroon", "CM", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Central African Republic", "CF", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Chad", "TD", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Comoros", "KM", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Cote d'Ivoire", "CI", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Democratic Republic of the Congo", "CD", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Djibouti", "DJ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Egypt", "EG", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Equatorial Guinea", "GQ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Eritrea", "ER", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Eswatini", "SZ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Ethiopia", "ET", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Gabon", "GA", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Gambia", "GM", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Ghana", "GH", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Guinea", "GN", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Guinea-Bissau", "GW", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Kenya", "KE", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Lesotho", "LS", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Liberia", "LR", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Libya", "LY", "Africa", "Zone 8", 143700, 327100, 508900, 181800],
  ["Madagascar", "MG", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Malawi", "MW", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Mali", "ML", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Mauritania", "MR", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Mauritius", "MU", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Morocco", "MA", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Mozambique", "MZ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Namibia", "NA", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Niger", "NE", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Republic of the Congo", "CG", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Rwanda", "RW", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Sao Tome and Principe", "ST", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Senegal", "SN", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Seychelles", "SC", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Sierra Leone", "SL", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Somalia", "SO", "Africa", "Zone 8", 143700, 327100, 508900, 181800],
  ["South Africa", "ZA", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["South Sudan", "SS", "Africa", "Zone 8", 143700, 327100, 508900, 181800],
  ["Sudan", "SD", "Africa", "Zone 8", 143700, 327100, 508900, 181800],
  ["Tanzania", "TZ", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Togo", "TG", "Africa", "Zone 1", 79400, 169900, 250500, 80600],
  ["Tunisia", "TN", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Uganda", "UG", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Zambia", "ZM", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  ["Zimbabwe", "ZW", "Africa", "Zone 2", 88100, 178600, 262500, 84000],
  // Asia
  ["Afghanistan", "AF", "Asia", "Zone 8", 143700, 327100, 508900, 181800],
  ["Armenia", "AM", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Azerbaijan", "AZ", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Bahrain", "BH", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Bangladesh", "BD", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Bhutan", "BT", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Brunei", "BN", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Cambodia", "KH", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["China", "CN", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Cyprus", "CY", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Georgia", "GE", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["India", "IN", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Indonesia", "ID", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Iran", "IR", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Iraq", "IQ", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Israel", "IL", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Japan", "JP", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Jordan", "JO", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Kazakhstan", "KZ", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Kuwait", "KW", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Kyrgyzstan", "KG", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Laos", "LA", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Lebanon", "LB", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Malaysia", "MY", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Maldives", "MV", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Mongolia", "MN", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Myanmar", "MM", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Nepal", "NP", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["North Korea", "KP", "Asia", "Zone 8", 143700, 327100, 508900, 181800],
  ["Oman", "OM", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Pakistan", "PK", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Palestine", "PS", "Asia", "Zone 8", 143700, 327100, 508900, 181800],
  ["Philippines", "PH", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Qatar", "QA", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Saudi Arabia", "SA", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Singapore", "SG", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["South Korea", "KR", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Sri Lanka", "LK", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Syria", "SY", "Asia", "Zone 8", 143700, 327100, 508900, 181800],
  ["Tajikistan", "TJ", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Thailand", "TH", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Timor-Leste", "TL", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Turkey", "TR", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Turkmenistan", "TM", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["United Arab Emirates", "AE", "Asia", "Zone 5", 113000, 241300, 361700, 120400],
  ["Uzbekistan", "UZ", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Vietnam", "VN", "Asia", "Zone 6", 125400, 270700, 401000, 130400],
  ["Yemen", "YE", "Asia", "Zone 8", 143700, 327100, 508900, 181800],
  // Europe
  ["Albania", "AL", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Andorra", "AD", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Austria", "AT", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Belarus", "BY", "Europe", "Zone 8", 143700, 327100, 508900, 181800],
  ["Belgium", "BE", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Bosnia and Herzegovina", "BA", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Bulgaria", "BG", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Croatia", "HR", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Czechia", "CZ", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Denmark", "DK", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Estonia", "EE", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Finland", "FI", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["France", "FR", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Germany", "DE", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Greece", "GR", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Holy See (Vatican City)", "VA", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Hungary", "HU", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Iceland", "IS", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Ireland", "IE", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Italy", "IT", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Latvia", "LV", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Liechtenstein", "LI", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Lithuania", "LT", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Luxembourg", "LU", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Malta", "MT", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Moldova", "MD", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Monaco", "MC", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Montenegro", "ME", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Netherlands", "NL", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["North Macedonia", "MK", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Norway", "NO", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Poland", "PL", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Portugal", "PT", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Romania", "RO", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Russia", "RU", "Europe", "Zone 8", 143700, 327100, 508900, 181800],
  ["San Marino", "SM", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Serbia", "RS", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Slovakia", "SK", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Slovenia", "SI", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Spain", "ES", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Sweden", "SE", "Europe", "Zone 5", 113000, 241300, 361700, 120400],
  ["Switzerland", "CH", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  ["Ukraine", "UA", "Europe", "Zone 8", 143700, 327100, 508900, 181800],
  ["United Kingdom", "GB", "Europe", "Zone 3", 96300, 218200, 331100, 113000],
  // North America
  ["Antigua and Barbuda", "AG", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Bahamas", "BS", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Barbados", "BB", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Belize", "BZ", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Canada", "CA", "North America", "Zone 4", 97200, 225500, 345900, 120400],
  ["Costa Rica", "CR", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Cuba", "CU", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Dominica", "DM", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Dominican Republic", "DO", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["El Salvador", "SV", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Grenada", "GD", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Guatemala", "GT", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Haiti", "HT", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Honduras", "HN", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Jamaica", "JM", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Mexico", "MX", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Nicaragua", "NI", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Panama", "PA", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Saint Kitts and Nevis", "KN", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Saint Lucia", "LC", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Saint Vincent and the Grenadines", "VC", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["Trinidad and Tobago", "TT", "North America", "Zone 6", 125400, 270700, 401000, 130400],
  ["United States", "US", "North America", "Zone 4", 97200, 225500, 345900, 120400],
  // Oceania
  ["Australia", "AU", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Fiji", "FJ", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Kiribati", "KI", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Marshall Islands", "MH", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Micronesia", "FM", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Nauru", "NR", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["New Zealand", "NZ", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Palau", "PW", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Papua New Guinea", "PG", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Samoa", "WS", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Solomon Islands", "SB", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Tonga", "TO", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Tuvalu", "TV", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  ["Vanuatu", "VU", "Oceania", "Zone 7", 137900, 283100, 413500, 130400],
  // South America
  ["Argentina", "AR", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Bolivia", "BO", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Brazil", "BR", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Chile", "CL", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Colombia", "CO", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Ecuador", "EC", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Guyana", "GY", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Paraguay", "PY", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Peru", "PE", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Suriname", "SR", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Uruguay", "UY", "South America", "Zone 7", 137900, 283100, 413500, 130400],
  ["Venezuela", "VE", "South America", "Zone 7", 137900, 283100, 413500, 130400],
];

// ── Seed functions ─────────────────────────────────────────

async function seedCouriers(client, brand) {
  let count = 0;
  for (const c of COURIERS) {
    const { rowCount } = await client.query(
      `INSERT INTO ${brand}.couriers
         (courier_key, display_name, description, integration_type,
          serves_local, serves_nationwide, serves_international,
          service_countries, rate_card, supports_pod, display_order,
          is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,true)
       ON CONFLICT (courier_key) DO UPDATE SET
         display_name          = EXCLUDED.display_name,
         description           = EXCLUDED.description,
         serves_local          = EXCLUDED.serves_local,
         serves_nationwide     = EXCLUDED.serves_nationwide,
         serves_international  = EXCLUDED.serves_international,
         service_countries     = EXCLUDED.service_countries,
         display_order         = EXCLUDED.display_order,
         updated_at            = now()`,
      [
        c.courier_key,
        c.display_name,
        c.description,
        c.integration_type,
        c.serves_local,
        c.serves_nationwide,
        c.serves_international,
        c.service_countries,
        c.rate_card,
        c.supports_pod,
        c.display_order,
      ],
    );
    count += rowCount;
  }
  return count;
}

async function upsertZone(client, brand, zone) {
  const { rowCount } = await client.query(
    `UPDATE ${brand}.delivery_zones
        SET fee_ngn      = $3,
            rate_card    = $4::jsonb,
            description  = $5,
            is_active    = true,
            updated_at   = now()
      WHERE name = $1 AND courier_key = $2`,
    [zone.name, zone.courier_key, zone.fee_ngn, zone.rate_card, zone.description],
  );
  if (rowCount > 0) return "updated";

  await client.query(
    `INSERT INTO ${brand}.delivery_zones
       (name, description, geometry_type, geometry, fee_ngn, country_code,
        priority, is_active, rate_card, courier_key)
     VALUES ($1,$2,'country','{}'::jsonb,$3,$4,$5,true,$6::jsonb,$7)`,
    [
      zone.name,
      zone.description,
      zone.fee_ngn,
      zone.country_code,
      zone.priority,
      zone.rate_card,
      zone.courier_key,
    ],
  );
  return "created";
}

async function seedLagosLGAs(client, brand) {
  let created = 0, updated = 0;
  for (const [name, code, distZone, f1, f2, f3, addon] of LAGOS_LGAS) {
    const result = await upsertZone(client, brand, {
      name,
      description: `Lagos LGA – ${distZone}. Pickup: Lekki Phase 1.`,
      country_code: code,
      priority: 30,
      fee_ngn: f1,
      rate_card: rc(f1, f2, f3, addon),
      courier_key: "safe_lagos",
    });
    if (result === "created") created++; else updated++;
  }
  return { created, updated };
}

async function seedNigeriaStates(client, brand) {
  let created = 0, updated = 0;
  for (const [name, code, geoZone, f1, f2, f3, addon] of NIGERIA_STATES) {
    const result = await upsertZone(client, brand, {
      name,
      description: `${geoZone} Nigeria. Nationwide delivery.`,
      country_code: code,
      priority: 20,
      fee_ngn: f1,
      rate_card: rc(f1, f2, f3, addon),
      courier_key: "nationwide",
    });
    if (result === "created") created++; else updated++;
  }
  return { created, updated };
}

async function seedInternational(client, brand) {
  let created = 0, updated = 0;
  for (const [name, iso2, continent, dhlZone, f1, f2, f3, addon] of INTERNATIONAL) {
    const result = await upsertZone(client, brand, {
      name,
      description: `${continent} – DHL ${dhlZone}. Ships from Lagos.`,
      country_code: iso2,
      priority: 10,
      fee_ngn: f1,
      rate_card: rc(f1, f2, f3, addon),
      courier_key: "dhl_express",
    });
    if (result === "created") created++; else updated++;
  }
  return { created, updated };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const brand of BRANDS) {
      console.log(`\n── ${brand.toUpperCase()} ──────────────────────`);

      await seedCouriers(client, brand);
      console.log(`  Couriers: ${COURIERS.length} upserted`);

      const lagos = await seedLagosLGAs(client, brand);
      console.log(`  Lagos LGAs: ${lagos.created} created, ${lagos.updated} updated`);

      const states = await seedNigeriaStates(client, brand);
      console.log(`  Nigeria states: ${states.created} created, ${states.updated} updated`);

      const intl = await seedInternational(client, brand);
      console.log(`  International: ${intl.created} created, ${intl.updated} updated`);

      const total = lagos.created + lagos.updated + states.created + states.updated + intl.created + intl.updated;
      console.log(`  Total zones: ${total}`);
    }

    await client.query("COMMIT");
    console.log("\nDone. All logistics rates seeded.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
