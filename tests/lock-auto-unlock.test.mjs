import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const start=index.indexOf('async function tryAutoUnlock(){'),end=index.indexOf('function renderLock(){',start);
assert.ok(start>0&&end>start,'auto PIN routines found');
const autoPinCode=index.slice(start,end);
function harness(pin,length=0){
 const before=[
  "const lock={hash,pinLength,salt:'test'};",
  "const phoneLockSettings=()=>lock;",
  "const phonePinDigest=async pin=>'hash:'+pin;",
  "let securityUnlocked=false,activeScreen='lock',lockVerifyAttempt=0,screen='lock';",
  "const nodes={lockPin:{value:''},lockRepeat:{value:''},lockFeedback:{textContent:''},",
  " lockDots:{querySelectorAll:()=>Array.from({length:6},()=>({classList:{toggle(){}}}))}};",
  "const setScreen=s=>{screen=s;activeScreen=s;};"
 ].join('\n');
 const after="return {lockDigit,get:()=>({screen,pin:nodes.lockPin.value,feedback:nodes.lockFeedback.textContent,unlocked:securityUnlocked})};";
 return new Function('hash','pinLength',before+'\n'+autoPinCode+'\n'+after)('hash:'+pin,length);
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('stored 4/5/6-digit PINs unlock without confirmation',async()=>{
 for(const length of [4,5,6]){
  const pin='123456'.slice(0,length),app=harness(pin,length);
  for(const digit of pin)app.lockDigit(digit);
  await flush();
  assert.equal(app.get().screen,'home',pin);
  assert.equal(app.get().unlocked,true,pin);
  assert.equal(app.get().pin,'',pin);
 }
});
test('legacy PINs without stored length also unlock automatically',async()=>{
 for(const length of [4,5,6]){
  const pin='123456'.slice(0,length),app=harness(pin);
  for(const digit of pin)app.lockDigit(digit);
  await flush();
  assert.equal(app.get().screen,'home',pin);
 }
});
test('wrong saved PIN resets; old PIN without length reports error at 6 digits',async()=>{
 const current=harness('9876',4);
 for(const digit of '1234')current.lockDigit(digit);
 await flush();
 assert.equal(current.get().screen,'lock');
 assert.match(current.get().feedback,/密码不正确/);
 assert.equal(current.get().pin,'');
 const legacy=harness('9876');
 for(const digit of '12345')legacy.lockDigit(digit);
 await flush();
 assert.equal(legacy.get().feedback,'');
 assert.equal(legacy.get().pin,'12345');
 legacy.lockDigit('6');await flush();
 assert.match(legacy.get().feedback,/密码不正确/);
 assert.equal(legacy.get().pin,'');
});
test('unlock button hidden for stored PIN, preserved for initial PIN setup',()=>{
 assert.ok(index.includes('nodes.lockAction.hidden=Boolean(lock.hash)'));
 assert.ok(index.includes('pinLength:newPin.length'));
 assert.ok(index.includes('pinLength:pin.length'));
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.ok(css.includes('.lp-lock-submit[hidden]{display:none!important;}'));
});
