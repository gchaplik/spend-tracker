import React from "react";

const _sv=(color,children)=>React.createElement('svg',{width:20,height:20,viewBox:"0 0 20 20",fill:"none",stroke:color,strokeWidth:1.5,strokeLinecap:"round",strokeLinejoin:"round"},children);
const _p=(d,extra={})=>React.createElement('path',{d,...extra});
const _c=(cx,cy,r,extra={})=>React.createElement('circle',{cx,cy,r,...extra});
const _r=(x,y,width,height,extra={})=>React.createElement('rect',{x,y,width,height,...extra});
const _pl=(points,extra={})=>React.createElement('polyline',{points,...extra});
const _pg=(points,fill)=>React.createElement('polygon',{points,fill,stroke:"none"});
const _ln=(x1,y1,x2,y2)=>React.createElement('line',{x1,y1,x2,y2});

export const ICON_SET=[
  // ── Food & Drink ──────────────────────────────────────────────────────────
  {key:"grocery",    label:"Groceries",    group:"Food",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.5 8h7l1.5-5H7"/><circle cx="8.5" cy="15" r="1"/><circle cx="14.5" cy="15" r="1"/></svg>},
  {key:"dining",     label:"Dining",       group:"Food",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v5a3 3 0 01-3 3v6"/><path d="M12 3v14"/><path d="M16 3c0 3-1.5 5-1.5 5v8.5"/></svg>},
  {key:"coffee",     label:"Coffee",       group:"Food",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 8h9v6a3 3 0 01-3 3H8a3 3 0 01-3-3V8z"/><path d="M14 10h2a2 2 0 010 4h-2"/><path d="M7 5c0-1 .5-2 1.5-2S10 4 11 4s2-1 2-1"/></svg>},
  {key:"pizza",      label:"Takeout",      group:"Food",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L3 17h14L10 3z"/><path d="M10 3c1.5 3 3 6 0 9"/><circle cx="8" cy="13" r="1" fill={c} stroke="none"/></svg>},
  {key:"cocktail",   label:"Bar / Drinks", group:"Food",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h12l-6 7v5"/><path d="M7 16h6"/><path d="M7 8h6"/></svg>},
  // ── Transport ─────────────────────────────────────────────────────────────
  {key:"car",        label:"Car / Auto",   group:"Transport",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="14" height="7" rx="2"/><path d="M6 9V7a4 4 0 018 0v2"/><circle cx="6.5" cy="15.5" r="1.5"/><circle cx="13.5" cy="15.5" r="1.5"/></svg>},
  {key:"gas",        label:"Gas / Fuel",   group:"Transport",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 17V5a2 2 0 012-2h4a2 2 0 012 2v5h1a2 2 0 012 2v3a1 1 0 002 0v-5l-2-3"/><path d="M5 10h8"/></svg>},
  {key:"transit",    label:"Transit",      group:"Transport",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="12" height="12" rx="3"/><path d="M4 9h12"/><circle cx="7" cy="18" r="1.5"/><circle cx="13" cy="18" r="1.5"/><path d="M7 15v3M13 15v3"/></svg>},
  {key:"airplane",   label:"Flights",      group:"Transport",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M17 8l-3-5H9L6 8l-3 1 3 2v5l4-1 4 1v-5l3-2z"/><path d="M10 9v3"/></svg>},
  {key:"bicycle",    label:"Cycling",      group:"Transport",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="14" r="3"/><circle cx="15" cy="14" r="3"/><path d="M5 14l4-7h3l3 7"/><path d="M9 7l2 7"/></svg>},
  // ── Home ──────────────────────────────────────────────────────────────────
  {key:"house",      label:"Housing",      group:"Home",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L10 3l7 6.5"/><path d="M6 9v8h8V9"/><rect x="8" y="13" width="4" height="4"/></svg>},
  {key:"wrench",     label:"Repairs",      group:"Home",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2.5a4 4 0 00-4 5.7L3 15.7 4.3 17l7.5-7.5A4 4 0 1014.5 2.5z"/><path d="M13 4l3 3"/></svg>},
  {key:"lightning",  label:"Utilities",    group:"Home",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M13 3L7 11h6l-1 6 6-8h-6l1-6z"/></svg>},
  {key:"wifi",       label:"Internet",     group:"Home",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 8.5a10 10 0 0116 0"/><path d="M5 11.5a6 6 0 0110 0"/><path d="M8 14.5a3 3 0 014 0"/><circle cx="10" cy="17" r="1" fill={c} stroke="none"/></svg>},
  {key:"phone",      label:"Phone / Cell", group:"Home",     svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="8" height="16" rx="2"/><circle cx="10" cy="15" r="1" fill={c} stroke="none"/></svg>},
  // ── Shopping ──────────────────────────────────────────────────────────────
  {key:"bag",        label:"Shopping",     group:"Shopping", svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L4 7h12l-2-5z"/><path d="M4 7v9a2 2 0 002 2h8a2 2 0 002-2V7"/><path d="M8 7c0 2 4 2 4 0"/></svg>},
  {key:"tag",        label:"Clothing",     group:"Shopping", svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6l8 8-6 6-8-8V3z"/><circle cx="7" cy="7" r="1.5" fill={c} stroke="none"/></svg>},
  {key:"gift",       label:"Gifts",        group:"Shopping", svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="14" height="10" rx="1"/><path d="M3 8h14M10 8V3"/><path d="M7 5c-1-2 2-3 3-1 1-2 4-1 3 1H7z"/></svg>},
  {key:"cart",       label:"Online Order", group:"Shopping", svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h2l3 9h8l2-6H7"/><circle cx="9" cy="16" r="1.5"/><circle cx="15" cy="16" r="1.5"/></svg>},
  // ── Health ────────────────────────────────────────────────────────────────
  {key:"cross",      label:"Medical",      group:"Health",   svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 4v12M4 10h12"/><rect x="3" y="3" width="14" height="14" rx="3"/></svg>},
  {key:"heart",      label:"Health",       group:"Health",   svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 17s-8-4.9-8-9.5A5 5 0 0110 5.1 5 5 0 0118 7.5C18 12.1 10 17 10 17z"/></svg>},
  {key:"pill",       label:"Pharmacy",     group:"Health",   svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="9" width="12" height="6" rx="3"/><path d="M4 12h12"/></svg>},
  {key:"dumbbell",   label:"Fitness",      group:"Health",   svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h14"/><rect x="1" y="8" width="3" height="4" rx="1"/><rect x="16" y="8" width="3" height="4" rx="1"/><rect x="5" y="7" width="2" height="6" rx="1"/><rect x="13" y="7" width="2" height="6" rx="1"/></svg>},
  // ── Finance ───────────────────────────────────────────────────────────────
  {key:"trending-up",label:"Income",       group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="3,13 7,8 11,11 17,5"/><polyline points="13,5 17,5 17,9"/></svg>},
  {key:"wallet",     label:"Wallet",       group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="16" height="12" rx="2"/><path d="M2 9h16"/><circle cx="15" cy="14" r="1.5" fill={c} stroke="none"/><path d="M13 5V4a2 2 0 012-2h1"/></svg>},
  {key:"card",       label:"Credit Card",  group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="16" height="11" rx="2"/><path d="M2 9h16"/><path d="M5 13h3"/></svg>},
  {key:"bank",       label:"Bank",         group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h14M3 8h14M10 3L3 8h14L10 3z"/><path d="M5 8v9M10 8v9M15 8v9"/></svg>},
  {key:"piggy",      label:"Savings",      group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M14 8A5 5 0 104 13v2l1 1h1l1 1h4l1-1h1l1-1v-2a5 5 0 00-0.2-1.4"/><path d="M15 7a2 2 0 012 2"/><path d="M10 9v2"/></svg>},
  {key:"shield",     label:"Insurance",    group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z"/><path d="M7 10l2 2 4-4"/></svg>},
  {key:"receipt",    label:"Taxes",        group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 2h10v16l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5V2z"/><path d="M8 7h4M8 10h4M8 13h2"/></svg>},
  {key:"repeat",     label:"Subscription", group:"Finance",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a6 6 0 1110.9-3.5"/><path d="M17 4l-2.5 3-2.5-3"/><path d="M16 10a6 6 0 01-10.9 3.5"/><path d="M3 16l2.5-3 2.5 3"/></svg>},
  // ── Lifestyle ─────────────────────────────────────────────────────────────
  {key:"play",       label:"Entertainment",group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="14" height="10" rx="2"/><polygon points="8,8 8,12 13,10" fill={c} stroke="none"/></svg>},
  {key:"music",      label:"Music",        group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8 17V6l9-2v11"/><circle cx="6" cy="17" r="2"/><circle cx="15" cy="15" r="2"/></svg>},
  {key:"book",       label:"Education",    group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h10a2 2 0 012 2v11a2 2 0 01-2 2H4V3z"/><path d="M8 3v14"/><path d="M10 7h4M10 10h4M10 13h4"/></svg>},
  {key:"scissors",   label:"Personal Care",group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="14" r="2.5"/><path d="M8 7.5L17 14"/><path d="M8 12.5L17 6"/></svg>},
  {key:"globe",      label:"Travel",       group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 3c-2 2-3 4.5-3 7s1 5 3 7"/><path d="M10 3c2 2 3 4.5 3 7s-1 5-3 7"/><path d="M3 10h14"/></svg>},
  {key:"paw",        label:"Pets",         group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><ellipse cx="10" cy="13" rx="4" ry="3"/><circle cx="5.5" cy="9" r="1.5"/><circle cx="14.5" cy="9" r="1.5"/><circle cx="8" cy="7" r="1.5"/><circle cx="12" cy="7" r="1.5"/></svg>},
  {key:"baby",       label:"Kids",         group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="6" r="3"/><path d="M6 20v-4a2 2 0 012-2h4a2 2 0 012 2v4"/><path d="M7.5 9.5L5 14h10l-2.5-4.5"/></svg>},
  {key:"sun",        label:"Hobbies",      group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="3"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.6 5.6l1.4 1.4M13 13l1.4 1.4M5.6 14.4l1.4-1.4M13 7l1.4-1.4"/></svg>},
  {key:"leaf",       label:"Environment",  group:"Lifestyle",svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M17 3c-5 0-11 3-11 10 0 2 1 4 1 4s2-1 4-1c7 0 10-6 10-11 0 0-1.5-2-4-2z"/><path d="M3 17c2-4 5-6 8-7"/></svg>},
  // ── General ───────────────────────────────────────────────────────────────
  {key:"clock",      label:"Other",        group:"General",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v5l3 3"/></svg>},
  {key:"star",       label:"Favourite",    group:"General",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 2l2.4 5H18l-4.5 3.3 1.7 5.3L10 12.5l-5.2 3.1 1.7-5.3L2 7h5.6z"/></svg>},
  {key:"umbrella",   label:"Miscellaneous",group:"General",  svg:c=><svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10 3a8 8 0 00-8 7h16a8 8 0 00-8-7z"/><path d="M10 10v7a2 2 0 004 0"/></svg>},
];

export const ICON_BY_KEY=Object.fromEntries(ICON_SET.map(i=>[i.key,i]));
export const ICON_GROUPS=[...new Set(ICON_SET.map(i=>i.group))];

export const ICON_KEYWORDS=[
  [/grocer|supermark|market|produce|costco|walmart|loblaws/i,"grocery"],
  [/dine|dining|restaur|takeout|take.out|delivery|fast.food|meal|lunch|dinner|breakfast/i,"dining"],
  [/coffee|cafe|espresso|latte|cappuc|starbucks|tim.horton/i,"coffee"],
  [/pizza|sushi|burger|taco|food/i,"pizza"],
  [/bar|pub|alcohol|beer|wine|drink|cocktail/i,"cocktail"],
  [/uber|lyft|taxi|cab|transit|bus|subway|metro|train/i,"transit"],
  [/gas|fuel/i,"gas"],
  [/car|auto|vehicle|truck|motor|parking|toll|mechanic/i,"car"],
  [/flight|airline|airplane/i,"airplane"],
  [/bike|cycling|bicycle/i,"bicycle"],
  [/hous|rent|mortgage|home|property|real.estat|condo|apart|lease/i,"house"],
  [/repair|reno|maint|hardware/i,"wrench"],
  [/electric|hydro|water|utilit/i,"lightning"],
  [/internet|wifi/i,"wifi"],
  [/phone|cell|mobile|rogers|bell|telus/i,"phone"],
  [/shop|retail|amazon|online|mall|boutique/i,"bag"],
  [/cloth|fashion|apparel|wear|shoes|dress|outfit/i,"tag"],
  [/gift|donat|charit|present/i,"gift"],
  [/health|medic|doctor|dental|dentist|hospital|clinic|prescri|eye|vision|therapy|chiro|physio/i,"cross"],
  [/pharmacy|pharma|drug/i,"pill"],
  [/fitness|gym|sport|workout|exercise|yoga|run|swim/i,"dumbbell"],
  [/insur|coverage|premium/i,"shield"],
  [/saving|invest|rrsp|tfsa|portfolio|retire/i,"piggy"],
  [/tax|irs|cra|filing/i,"receipt"],
  [/subscri|membership/i,"repeat"],
  [/cable|stream|netflix|spotify|music.sub/i,"repeat"],
  [/entertain|movie|cinema|film|game|gaming|concert|event|ticket|show|theatre|theater/i,"play"],
  [/music|song|album/i,"music"],
  [/educ|school|tuition|course|book|tutoring|college|univers|learn|training/i,"book"],
  [/beauty|hair|spa|salon|barber|grooming|cosmetic|makeup|personal.care/i,"scissors"],
  [/travel|vacation|trip|hotel|airbnb|resort|tour|holiday|luggage/i,"globe"],
  [/pet|dog|cat|vet|animal/i,"paw"],
  [/kid|child|baby|daycare|toy/i,"baby"],
  [/hobby|sport.equip|craft/i,"sun"],
  [/atm|cash|bank|transfer|wire|withdrawal|deposit/i,"bank"],
  [/card|credit|visa|mastercard/i,"card"],
  [/wallet|spend/i,"wallet"],
];

export function getCatIcon(category="",type="expense",color="currentColor",catIcons={}){
  if(type==="income") return ICON_BY_KEY["trending-up"].svg(color);
  const override=catIcons[category];
  if(override){
    if(override.startsWith("data:")||override.startsWith("http")){
      return <img src={override} style={{width:20,height:20,borderRadius:4,objectFit:"cover"}} alt=""/>;
    }
    if(ICON_BY_KEY[override]) return ICON_BY_KEY[override].svg(color);
  }
  const c=(category||"").toLowerCase();
  for(const [re,key] of ICON_KEYWORDS){
    if(re.test(c)&&ICON_BY_KEY[key]) return ICON_BY_KEY[key].svg(color);
  }
  return ICON_BY_KEY["clock"].svg(color);
}
