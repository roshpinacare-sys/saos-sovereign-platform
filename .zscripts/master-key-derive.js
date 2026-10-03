/**
 * master-key-derive.js — גזירת מפתחות-תפקיד מסיסמאות-אב P5 והתאמה מול השרשרת.
 * dhive exact: PrivateKey.fromLogin(u,p,role) = sha256(u+role+p) → compressed pubkey.
 */
const crypto = require('crypto');
const fs = require('fs');
const bs58 = require('bs58').default;

function sha256(b){ return crypto.createHash('sha256').update(b).digest(); }
// graphene STM public key encode: prefix + base58(compressed_pub + ripemd160(sha256(pub))[0:4])
function stmPub(compressed){
  const rmd = crypto.createHash('rmd160').update(compressed).digest().slice(0,4);
  return 'STM' + bs58.encode(Buffer.concat([Buffer.from(compressed), rmd]));
}
// derive compressed pubkey from 32-byte scalar using the same secp256k1 lib dhive uses
const secp = require('@noble/curves/secp256k1.js').secp256k1;
function pubFromScalar(scalar){
  return secp.getPublicKey(scalar, true); // compressed
}
const ROSTER = ["headcorner","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];
const ROLES = ["posting","active","owner","memo"];

const text = fs.readFileSync('/home/z/my-project/upload/בחן.txt','utf8');
const lines = text.split(/\r?\n/);
const passes = [];
for(const l of lines){
  const m = l.match(/P5[1-9A-HJ-NP-Za-km-z]{49,52}/g);
  if(m) for(const p of m) passes.push(p);
}
console.log('master passwords extracted:', passes.length);

// load full authority index
const auth = JSON.parse(fs.readFileSync('/tmp/authorities.json','utf8'));
const pubIndex = new Map(); // pub → "chain/account/role#i"
for(const [k, roles] of Object.entries(auth)){
  const [chain, account] = k.split('/');
  roles.posting.forEach((p,i)=>pubIndex.set(p, `${chain}/${account}/posting#${i}`));
  roles.active.forEach((p,i)=>pubIndex.set(p, `${chain}/${account}/active#${i}`));
  roles.owner.forEach((p,i)=>pubIndex.set(p, `${chain}/${account}/owner#${i}`));
  if(roles.memo) pubIndex.set(roles.memo, `${chain}/${account}/memo#0`);
}
console.log('authority pubkeys indexed:', pubIndex.size);

let matches = 0;
const results = [];
for(let pi=0; pi<passes.length; pi++){
  const pass = passes[pi];
  const variants = [pass, pass.slice(1)]; // full "P5..." and stripped "5..."
  let hit = false;
  for(const v of variants){
    for(const account of ROSTER){
      for(const role of ROLES){
        const scalar = sha256(Buffer.from(account + role + v, 'utf8'));
        const pub = stmPub(pubFromScalar(scalar));
        const hitKey = pubIndex.get(pub);
        if(hitKey){
          console.log(`P${pi+1} variant=${v===pass?'full':'stripped'} × ${account}/${role} → MATCH ${hitKey}`);
          results.push({passIdx: pi+1, account, role, pub, hitKey, pass});
          matches++; hit = true;
        }
      }
    }
  }
  if(!hit) console.log(`P${pi+1}: no match across 12 accounts × 4 roles (both variants)`);
}
console.log('\nTOTAL MATCHES:', matches);
fs.writeFileSync('/tmp/master-matches.json', JSON.stringify(results.map(r=>({passIdx:r.passIdx, account:r.account, role:r.role, chain:r.hitKey.split('/')[0], hitKey:r.hitKey})), null, 1));
