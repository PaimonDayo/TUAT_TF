import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(names){
 const sheets=names.map(name=>({getName:()=>name}));
 const ctx=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../../gas/sync-clasp/Code.js',import.meta.url),'utf8'),ctx);
 ctx.getSpreadsheet=()=>({getSheetByName:name=>sheets.find(s=>s.getName()===name),getSheets:()=>sheets});
 return ctx.findMemberSheet;
}
test('member lookup tolerates surrounding whitespace without guessing a different member',()=>{
 assert.equal(setup([' B2 テスト　'])('B2 テスト').getName(),' B2 テスト　');
 assert.equal(setup(['B2 テスト'])('B2 別人'),null);
 assert.equal(setup(['B2 テスト',' B2 テスト'])('B2 テスト').getName(),'B2 テスト');
 assert.throws(()=>setup([' B2 テスト','B2 テスト '])('B2 テスト'),/複数/);
});
