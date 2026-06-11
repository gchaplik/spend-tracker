export function _b64e(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)));}
export function _b64d(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
export function _b64ue(buf){return _b64e(buf).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function _b64ud(str){return _b64d(str.replace(/-/g,'+').replace(/_/g,'/'));}

export async function hashPin(pin,salt){
  const enc=new TextEncoder();
  const km=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:200000,hash:'SHA-256'},km,256);
  return _b64e(bits);
}

export function genSalt(){return _b64e(crypto.getRandomValues(new Uint8Array(16)));}

export function _b32d(s){
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s=s.toUpperCase().replace(/=+$/,'');
  let bits=0,val=0;const out=[];
  for(const c of s){const i=A.indexOf(c);if(i<0)continue;val=(val<<5)|i;bits+=5;if(bits>=8){bits-=8;out.push((val>>bits)&0xff);}}
  return new Uint8Array(out);
}

export async function calcTOTP(secret,time=Date.now()){
  const t=Math.floor(time/1000/30);
  const ctr=new Uint8Array(8);new DataView(ctr.buffer).setUint32(4,t,false);
  const ck=await crypto.subtle.importKey('raw',_b32d(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',ck,ctr));
  const off=sig[19]&0xf;
  const code=((sig[off]&0x7f)<<24)|(sig[off+1]<<16)|(sig[off+2]<<8)|sig[off+3];
  return String(code%1000000).padStart(6,'0');
}

export function genTOTPSecret(){
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b=>A[b%32]).join('');
}
