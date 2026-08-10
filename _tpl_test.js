function P(v){return (v&&v.trim())?v.trim():'产品';}
function SC(s){return (s.scene&&s.scene.trim())?s.scene.trim():'日常场景';}
function ST(s){return (s.style&&s.style.trim())?s.style.trim()+'风格':'明亮清新、生活化广告风格';}
function DUR(s){const d=parseInt(s.dur,10);return (d>=4&&d<=15)?d:5;}
const TEMPLATES=[
 {id:'koubo',name:'口播种草',build:s=>'第一人称真人出镜视角，'+P(s.product)+'种草短视频...适配'+DUR(s)+'秒'},
 {id:'pain',name:'痛点反转',build:s=>'剧情向短视频：'+(s.audience||'用户')+'在'+SC(s)+'...适配'+DUR(s)+'秒'},
 {id:'compare',name:'对比测评',build:s=>'左右分屏...'+ST(s)+'...适配'+DUR(s)+'秒'},
 {id:'scene',name:'场景代入',build:s=>'生活化...'+SC(s)+'中自然使用'+P(s.product)+'...'+ST(s)},
 {id:'story',name:'剧情种草',build:s=>'微剧情...'+(s.audience||'主角')+'在'+SC(s)+'...'},
 {id:'tutorial',name:'教程演示',build:s=>'步骤演示...'+P(s.product)+'...'+ST(s)}
];
function composeImported(d){
 const prod=d.产品||d.product||d.素材名||d.素材ID||'产品';
 const parts=['基于爆款可复制方向生成「'+prod+'」短视频：'];
 const pick=(...ks)=>ks.map(k=>d[k]).find(v=>v!=null&&String(v).trim());
 const dir=pick('可复制方向','dir','方向');
 const sell=pick('核心卖点','sellpoint','卖点');
 const hook=pick('钩子','开头3秒','hook');
 const shots=pick('画面分镜','分镜','shots');
 const script=pick('口播脚本','脚本','script');
 if(dir)parts.push(String(dir));
 if(sell)parts.push('核心卖点：'+sell);
 if(hook)parts.push('开头钩子：'+hook);
 if(shots)parts.push('画面分镜：'+shots);
 if(script)parts.push('口播基调：'+script);
 const dd=parseInt(pick('时长','时长秒')||'5',10);
 parts.push('电影感写实广告质感，适配'+(dd>=4&&dd<=15?dd:5)+'秒、9:16 竖屏。');
 return parts.join('。');
}
const sample={product:'果茶',sellpoint:'0糖0卡',dur:'8'};
TEMPLATES.forEach(t=>console.log('['+t.name+']',t.build(sample).slice(0,70)+'...'));
const imp={素材ID:'CH123',产品:'扫地机',可复制方向:'复刻并压成本',核心卖点:'自动集尘',钩子:'开头3秒展示满地毛发',画面分镜:'1全景 2特写 3成果',时长秒:'10'};
console.log('[imported]',composeImported(imp));
console.log('ALL OK');
