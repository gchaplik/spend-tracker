import { CADENCES } from "../constants/index.js";

export const fmt = n => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(n||0);
export const fmtUSD = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0);
export const today = () => new Date().toISOString().split("T")[0];
export const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
export const toB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
export const cLabel = v => (CADENCES.find(c=>c.v===v)||{l:v}).l;
export const isPdf = mtype => mtype === "application/pdf";
export const fpHash = b64 => {
  let h = 0;
  const step = Math.max(1, b64.length >> 10);
  for (let i = 0; i < b64.length; i += step) h = (Math.imul(31, h) + b64.charCodeAt(i)) | 0;
  return b64.length + '_' + h;
};
