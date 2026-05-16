export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request);
    } catch (e) {
      return new Response(`
        <h1>系统错误</h1>
        <pre>${escapeHtml(e.stack || e.toString())}</pre>
      `, {
        headers: { "content-type": "text/html;charset=utf-8" }
      });
    }
  }
};

const SEARCH_ENGINES = {
  baidu: {
    name: "百度",
    search: "https://www.baidu.com/s?wd=",
    mobileUA: false
  },
  bing: {
    name: "必应",
    search: "https://cn.bing.com/search?q=",
    mobileUA: false
  },
  sogou: {
    name: "搜狗",
    search: "https://www.sogou.com/web?query=",
    mobileUA: false
  },
  sm: {
    name: "神马",
    search: "https://m.sm.cn/s?q=",
    mobileUA: true
  }
};

async function handleRequest(request) {
  const url = new URL(request.url);

  // 首页
  if (url.pathname === "/") {
    return htmlResponse(renderHome());
  }

  // 搜索 API
  if (url.pathname === "/api/search") {
    return handleSearch(request);
  }

  // 打开网页反代
  if (url.pathname === "/go") {
    return proxyPage(request);
  }

  return new Response("404", { status: 404 });
}

/**
 * 搜索处理
 */
async function handleSearch(request) {
  const url = new URL(request.url);

  const keyword = (url.searchParams.get("q") || "").trim();
  const engine = url.searchParams.get("engine") || "mix";

  if (!keyword) {
    return json({
      success: false,
      msg: "请输入关键词"
    });
  }

  let results = [];

  if (engine === "mix") {
    const tasks = Object.keys(SEARCH_ENGINES).map(async key => {
      try {
        return await searchEngine(key, keyword);
      } catch {
        return [];
      }
    });

    const all = await Promise.all(tasks);

    results = all.flat();

    // 去重
    const map = new Map();

    for (const item of results) {
      const key =
        normalize(item.title) +
        normalize(item.url);

      if (!map.has(key)) {
        map.set(key, item);
      }
    }

    results = [...map.values()];
  } else {
    results = await searchEngine(engine, keyword);
  }

  return json({
    success: true,
    count: results.length,
    results
  });
}

/**
 * 单搜索引擎
 */
async function searchEngine(engine, keyword) {
  switch (engine) {
    case "baidu":
      return await searchBaidu(keyword);

    case "bing":
      return await searchBing(keyword);

    case "sogou":
      return await searchSogou(keyword);

    case "sm":
      return await searchSM(keyword);

    default:
      return [];
  }
}

/**
 * 百度
 */
async function searchBaidu(keyword) {
  const html = await fetchText(
    `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`
  );

  const results = [];

  const reg =
    /<h3 class=".*?">[\s\S]*?<a.*?href="(.*?)".*?>([\s\S]*?)<\/a>[\s\S]*?<div class="c-abstract.*?">([\s\S]*?)<\/div>/g;

  let m;

  while ((m = reg.exec(html)) !== null) {
    const link = cleanHtml(m[1]);
    const title = cleanHtml(m[2]);
    const desc = cleanHtml(m[3]);

    if (
      !title ||
      title.includes("广告") ||
      desc.includes("广告")
    ) continue;

    results.push({
      engine: "百度",
      title,
      desc,
      url: link
    });
  }

  return results.slice(0, 15);
}

/**
 * 必应
 */
async function searchBing(keyword) {
  const html = await fetchText(
    `https://cn.bing.com/search?q=${encodeURIComponent(keyword)}`
  );

  const results = [];

  const reg =
    /<li class="b_algo".*?>[\s\S]*?<h2><a href="(.*?)".*?>([\s\S]*?)<\/a><\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/g;

  let m;

  while ((m = reg.exec(html)) !== null) {
    const link = cleanHtml(m[1]);
    const title = cleanHtml(m[2]);
    const desc = cleanHtml(m[3]);

    if (!title) continue;

    results.push({
      engine: "必应",
      title,
      desc,
      url: link
    });
  }

  return results.slice(0, 15);
}

/**
 * 搜狗
 */
async function searchSogou(keyword) {
  const html = await fetchText(
    `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}`
  );

  const results = [];

  const reg =
    /<a id="uigs.*?" href="(.*?)".*?>([\s\S]*?)<\/a>[\s\S]*?<p class="str-info.*?">([\s\S]*?)<\/p>/g;

  let m;

  while ((m = reg.exec(html)) !== null) {
    const link = cleanHtml(m[1]);
    const title = cleanHtml(m[2]);
    const desc = cleanHtml(m[3]);

    if (!title) continue;

    results.push({
      engine: "搜狗",
      title,
      desc,
      url: link
    });
  }

  return results.slice(0, 15);
}

/**
 * 神马搜索
 */
async function searchSM(keyword) {
  const html = await fetchText(
    `https://m.sm.cn/s?q=${encodeURIComponent(keyword)}`,
    true
  );

  const results = [];

  const reg =
    /<a.*?href="(.*?)".*?class=".*?title.*?".*?>([\s\S]*?)<\/a>[\s\S]*?<div class=".*?content.*?">([\s\S]*?)<\/div>/g;

  let m;

  while ((m = reg.exec(html)) !== null) {
    const link = cleanHtml(m[1]);
    const title = cleanHtml(m[2]);
    const desc = cleanHtml(m[3]);

    if (!title) continue;

    results.push({
      engine: "神马",
      title,
      desc,
      url: link
    });
  }

  return results.slice(0, 15);
}

/**
 * 反代网页
 */
async function proxyPage(request) {
  const url = new URL(request.url);

  const target = url.searchParams.get("url");

  if (!target) {
    return new Response("missing url");
  }

  try {
    const res = await fetch(target, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    let html = await res.text();

    // 删除 CSP
    html = html.replace(
      /<meta[^>]*content-security-policy[^>]*>/gi,
      ""
    );

    // 删除 X-Frame
    html = html.replace(
      /X-Frame-Options/gi,
      ""
    );

    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  } catch {
    return new Response("proxy failed");
  }
}

/**
 * fetch html
 */
async function fetchText(url, mobile = false) {
  const res = await fetch(url, {
    headers: {
      "user-agent": mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

      "accept-language": "zh-CN,zh;q=0.9"
    }
  });

  return await res.text();
}

/**
 * 工具
 */
function cleanHtml(str = "") {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&.*?;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(str = "") {
  return str
    .toLowerCase()
    .replace(/\s+/g, "");
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"]/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[m]));
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=utf-8"
    }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=utf-8"
    }
  });
}

/**
 * 页面
 */
function renderHome() {
  return `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>混合搜索</title>

<style>
*{
margin:0;
padding:0;
box-sizing:border-box;
}

body{
background:#050816;
font-family:Arial;
color:white;
overflow-x:hidden;
}

.bg{
position:fixed;
width:100%;
height:100%;
background:
radial-gradient(circle at top,#1d4ed8 0%,transparent 40%),
radial-gradient(circle at bottom,#7c3aed 0%,transparent 40%);
filter:blur(100px);
opacity:.35;
z-index:-1;
}

.container{
max-width:1100px;
margin:auto;
padding:40px 20px;
}

.logo{
font-size:48px;
font-weight:700;
text-align:center;
margin-top:40px;
margin-bottom:30px;
background:linear-gradient(90deg,#60a5fa,#a78bfa);
-webkit-background-clip:text;
-webkit-text-fill-color:transparent;
animation:fade 1s;
}

.search-box{
display:flex;
gap:10px;
background:rgba(255,255,255,.06);
padding:12px;
border-radius:22px;
backdrop-filter:blur(20px);
box-shadow:0 0 30px rgba(0,0,0,.3);
animation:up .8s;
}

.search-box input{
flex:1;
padding:16px;
background:transparent;
border:none;
outline:none;
color:white;
font-size:18px;
}

.search-box button{
border:none;
padding:0 30px;
border-radius:16px;
background:linear-gradient(90deg,#2563eb,#7c3aed);
color:white;
font-size:16px;
cursor:pointer;
transition:.3s;
}

.search-box button:hover{
transform:translateY(-2px) scale(1.03);
}

.engines{
display:flex;
gap:12px;
margin-top:20px;
flex-wrap:wrap;
justify-content:center;
}

.engine{
padding:10px 18px;
border-radius:14px;
background:rgba(255,255,255,.08);
cursor:pointer;
transition:.3s;
border:1px solid transparent;
}

.engine.active{
border:1px solid #60a5fa;
background:rgba(96,165,250,.15);
}

.results{
margin-top:35px;
}

.card{
background:rgba(255,255,255,.05);
padding:22px;
border-radius:18px;
margin-bottom:16px;
backdrop-filter:blur(12px);
transition:.35s;
animation:fade .5s;
border:1px solid rgba(255,255,255,.06);
}

.card:hover{
transform:translateY(-4px);
background:rgba(255,255,255,.08);
}

.card a{
font-size:22px;
color:#60a5fa;
text-decoration:none;
}

.card p{
margin-top:12px;
line-height:1.7;
color:#d1d5db;
}

.engine-tag{
display:inline-block;
margin-top:14px;
padding:5px 12px;
border-radius:999px;
background:rgba(99,102,241,.2);
font-size:13px;
}

.loading{
text-align:center;
padding:50px;
font-size:18px;
opacity:.8;
}

@keyframes fade{
from{
opacity:0;
transform:translateY(15px);
}
to{
opacity:1;
transform:none;
}
}

@keyframes up{
from{
opacity:0;
transform:translateY(30px);
}
to{
opacity:1;
transform:none;
}
}
</style>
</head>

<body>

<div class="bg"></div>

<div class="container">

<div class="logo">混合搜索</div>

<div class="search-box">
<input id="q" placeholder="输入关键词搜索..." />
<button onclick="search()">搜索</button>
</div>

<div class="engines">
<div class="engine active" data-v="mix">混合搜索</div>
<div class="engine" data-v="baidu">百度</div>
<div class="engine" data-v="bing">必应</div>
<div class="engine" data-v="sogou">搜狗</div>
<div class="engine" data-v="sm">神马</div>
</div>

<div class="results" id="results"></div>

</div>

<script>
let currentEngine = "mix";

document.querySelectorAll(".engine").forEach(el=>{
el.onclick=()=>{
document.querySelectorAll(".engine")
.forEach(a=>a.classList.remove("active"));

el.classList.add("active");

currentEngine=el.dataset.v;
};
});

async function search(){
const q=document.getElementById("q").value.trim();

if(!q)return;

const results=document.getElementById("results");

results.innerHTML='<div class="loading">正在搜索中...</div>';

try{

const res=await fetch(
'/api/search?q='+
encodeURIComponent(q)+
'&engine='+currentEngine
);

const data=await res.json();

if(!data.results.length){
results.innerHTML='<div class="loading">没有搜索结果</div>';
return;
}

results.innerHTML=data.results.map(item=>\`
<div class="card">
<a href="/go?url=\${encodeURIComponent(item.url)}" target="_blank">
\${item.title}
</a>

<p>\${item.desc}</p>

<div class="engine-tag">
\${item.engine}
</div>
</div>
\`).join('');

}catch(e){
results.innerHTML='<div class="loading">搜索失败</div>';
}
}

document.getElementById("q")
.addEventListener("keydown",e=>{
if(e.key==="Enter"){
search();
}
});
</script>

</body>
</html>
`;
}