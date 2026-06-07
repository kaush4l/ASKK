self.onmessage=r=>{let n;try{n=typeof r.data=="string"?JSON.parse(r.data):r.data}catch(t){self.postMessage(JSON.stringify({ok:!1,result:null,stdout:"",stderr:"",error:"exec worker received an unparseable message: "+String(t)}));return}const u=typeof n?.code=="string"?n.code:"",c=n?.input,e=[],o=[],p={log:(...t)=>e.push(t.map(format).join(" ")),info:(...t)=>e.push(t.map(format).join(" ")),debug:(...t)=>e.push(t.map(format).join(" ")),warn:(...t)=>o.push(t.map(format).join(" ")),error:(...t)=>o.push(t.map(format).join(" "))};(async()=>{let t=!0,i="",a;try{a=await new Function("console","input",`"use strict";
return (async () => {
`+u+`
})();`)(p,c)}catch(s){t=!1,i=s&&s.stack?String(s.stack):String(s)}self.postMessage(JSON.stringify({ok:t,result:safeValue(a),stdout:e.join(`
`),stderr:o.join(`
`),error:i}))})()};function format(r){if(typeof r=="string")return r;try{return JSON.stringify(r)}catch{return String(r)}}function safeValue(r){if(r===void 0)return null;try{return JSON.parse(JSON.stringify(r))}catch{return String(r)}}
