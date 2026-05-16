
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 首页
    if (url.pathname === "/") {
      return new Response(htmlPage(), {
        headers: {
          "content-type": "text/html;charset=UTF-8",
        },
      });
    }

    // 搜索接口
    if (url.pathname === "/api/search") {
      const keyword = url.searchParams.get("q") || "";
      const engine = url.searchParams.get("engine") || "mix";

      if (!keyword.trim()) {
        return json({
          success: false,
          msg: "请输入关键词",
        });
      }

      try {
        let results = [];

        // 混合搜索
        if (engine === "mix") {
          const all = await Promise.allSettled([
            searchBing(keyword),
            searchBaidu(keyword),
            searchSogou(keyword),
            searchSm(keyword),
          ]);

          for (const item of all) {
            if (item.status === "fulfilled") {
              results.push(...item.value);
            }
          }

        } else {
          if (engine === "bing") {
            results = await searchBing(keyword);
          }

          if (engine === "baidu") {
            results = await searchBaidu(keyword);
          }

          if (engine === "sogou") {
            results = await searchSogou(keyword);
          }

          if (engine === "sm") {
            results = await searchSm(keyword);
          }
        }

        // 去重
        const map = new Map();

        for (const item of results) {
          const key = normalize(item.title);

          if (!map.has(key)) {
            map.set(key, item);
          }
        }

        results = [...map.values()];

        // 排除广告
        results = results.filter(i => {
          const bad = [
            "广告",
            "推广",
            "赞助",
            "taobao",
            "tmall",
            "jd.com",
          ];

          return !bad.some(b =>
            (i.title + i.desc + i.url)
              .toLowerCase()
              .includes(b.toLowerCase())
          );
        });

        return json({
          success: true,
          total: results.length,
          data: results,
        });

      } catch (e) {
        return json({
          success: false,
          error: e.toString(),
        });
      }
    }

    return new Response("404");
  },
};

/* ===========================
   搜索引擎实现
=========================== */

// Bing
async function searchBing(q) {
  const url =
    `https://www.bing.com/search?q=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0",
    },
  });

  const html = await res.text();

  const arr = [];

  const blocks =
    [...html.matchAll(/<li class="b_algo".*?<\/li>/gs)];

  for (const item of blocks) {
    const block = item[0];

    const title =
      match(block, /<h2><a.*?>(.*?)<\/a>/s);

    const link =
      match(block, /<h2><a href="(.*?)"/s);

    const desc =
      match(block, /<p>(.*?)<\/p>/s);

    if (title && link) {
      arr.push({
        engine: "Bing",
        title: clearHtml(title),
        url: decodeHtml(link),
        desc: clearHtml(desc),
      });
    }
  }

  return arr;
}

// 百度
async function searchBaidu(q) {
  const url =
    `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0",
    },
  });

  const html = await res.text();

  const arr = [];

  const blocks =
    [...html.matchAll(/<div class="result.*?<\/div>\s*<\/div>/gs)];

  for (const item of blocks) {
    const block = item[0];

    const title =
      match(block, /<h3.*?>(.*?)<\/h3>/s);

    const link =
      match(block, /href="(http.*?)"/s);

    const desc =
      match(block, /<div class="c-abstract">(.*?)<\/div>/s);

    if (title && link) {
      arr.push({
        engine: "百度",
        title: clearHtml(title),
        url: decodeHtml(link),
        desc: clearHtml(desc),
      });
    }
  }

  return arr;
}

// 搜狗
async function searchSogou(q) {
  const url =
    `https://www.sogou.com/web?query=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0",
    },
  });

  const html = await res.text();

  const arr = [];

  const blocks =
    [...html.matchAll(/<div class="vrwrap".*?<\/div>\s*<\/div>/gs)];

  for (const item of blocks) {
    const block = item[0];

    const title =
      match(block, /<h3.*?>(.*?)<\/h3>/s);

    const link =
      match(block, /href="(.*?)"/s);

    const desc =
      match(block, /<p class="star-wiki-p">(.*?)<\/p>/s);

    if (title && link) {
      arr.push({
        engine: "搜狗",
        title: clearHtml(title),
        url: decodeHtml(link),
        desc: clearHtml(desc),
      });
    }
  }

  return arr;
}

// 神马
async function searchSm(q) {
  const url =
    `https://m.sm.cn/s?q=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0",
    },
  });

  const html = await res.text();

  const arr = [];

  const blocks =
    [...html.matchAll(/<section.*?<\/section>/gs)];

  for (const item of blocks) {
    const block = item[0];

    const title =
      match(block, /<h2.*?>(.*?)<\/h2>/s);

    const link =
      match(block, /href="(.*?)"/s);

    const desc =
      match(block, /<p.*?>(.*?)<\/p>/s);

    if (title && link) {
      arr.push({
        engine: "神马",
        title: clearHtml(title),
        url: decodeHtml(link),
        desc: clearHtml(desc),
      });
    }
  }

  return arr;
}

/* ===========================
   工具函数
=========================== */

function match(str, reg) {
  const m = str.match(reg);
  return m ? m[1] : "";
}

function clearHtml(str = "") {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(str = "") {
  return str
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fa5]/g, "");
}

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&");
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "access-control-allow-origin": "*",
    },
  });
}

/* ===========================
   页面
=========================== */

function htmlPage() {
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
background:#0f1117;
font-family:Arial;
color:#fff;
min-height:100vh;
}

.top{
padding:40px 20px;
text-align:center;
}

.logo{
font-size:42px;
font-weight:bold;
margin-bottom:25px;

background:linear-gradient(90deg,#00d2ff,#3a7bd5);
-webkit-background-clip:text;
-webkit-text-fill-color:transparent;
}

.search-box{
max-width:850px;
margin:auto;
display:flex;
gap:10px;
}

.search-box input{
flex:1;
height:55px;
border:none;
border-radius:14px;
padding:0 20px;
font-size:18px;
background:#1a1f2b;
color:#fff;
outline:none;
transition:0.3s;
}

.search-box input:focus{
transform:scale(1.01);
}

.search-box button{
width:130px;
border:none;
border-radius:14px;
cursor:pointer;
font-size:18px;
background:linear-gradient(90deg,#00d2ff,#3a7bd5);
color:#fff;
transition:0.3s;
}

.search-box button:hover{
transform:translateY(-2px);
}

.engines{
margin-top:18px;
display:flex;
justify-content:center;
gap:12px;
flex-wrap:wrap;
}

.engine{
padding:10px 18px;
border-radius:999px;
background:#1a1f2b;
cursor:pointer;
transition:0.3s;
}

.engine.active{
background:#3a7bd5;
}

.results{
max-width:900px;
margin:auto;
padding:20px;
}

.card{
background:#161b24;
padding:20px;
border-radius:18px;
margin-bottom:18px;
transition:0.3s;
animation:fade .4s ease;
}

.card:hover{
transform:translateY(-3px);
background:#1d2430;
}

.card a{
font-size:22px;
color:#6ab7ff;
text-decoration:none;
}

.card p{
margin-top:10px;
line-height:1.7;
color:#d0d0d0;
}

.tag{
display:inline-block;
margin-top:12px;
padding:6px 12px;
border-radius:999px;
background:#283041;
font-size:13px;
}

.loading{
text-align:center;
padding:50px;
font-size:20px;
opacity:0.7;
}

@keyframes fade{
from{
opacity:0;
transform:translateY(10px);
}
to{
opacity:1;
transform:none;
}
}

</style>
</head>

<body>

<div class="top">

<div class="logo">
混合搜索
</div>

<div class="search-box">
<input id="q" placeholder="输入关键词搜索...">
<button onclick="search()">搜索</button>
</div>

<div class="engines">

<div class="engine active" data-e="mix">
混合
</div>

<div class="engine" data-e="bing">
Bing
</div>

<div class="engine" data-e="baidu">
百度
</div>

<div class="engine" data-e="sogou">
搜狗
</div>

<div class="engine" data-e="sm">
神马
</div>

</div>

</div>

<div class="results" id="results"></div>

<script>

let engine = "mix";

document.querySelectorAll(".engine")
.forEach(el=>{

el.onclick=()=>{

document.querySelectorAll(".engine")
.forEach(i=>i.classList.remove("active"));

el.classList.add("active");

engine = el.dataset.e;

};

});

async function search(){

const q = document.getElementById("q").value.trim();

if(!q)return;

const box = document.getElementById("results");

box.innerHTML =
'<div class="loading">搜索中...</div>';

try{

const res = await fetch(
'/api/search?q='+
encodeURIComponent(q)+
'&engine='+engine
);

const json = await res.json();

if(!json.success){

box.innerHTML =
'<div class="loading">搜索失败</div>';

return;
}

if(json.data.length===0){

box.innerHTML =
'<div class="loading">没有搜索结果</div>';

return;
}

box.innerHTML = json.data.map(i=>\`

<div class="card">

<a href="\${i.url}"
target="_blank">
\${i.title}
</a>

<p>
\${i.desc || "暂无描述"}
</p>

<div class="tag">
\${i.engine}
</div>

</div>

\`).join("");

}catch(e){

box.innerHTML =
'<div class="loading">请求失败</div>';

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