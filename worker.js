export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 提供标准的搜索引擎风格前端页面
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(getEngineUI(), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    // 2. 真正的聚合反代接口
    if (url.pathname === "/api/search") {
      const keyword = url.searchParams.get("q") || "";
      const engine = url.searchParams.get("engine") || "mixed"; // mixed, baidu, bing, sm, sogou, so
      
      if (!keyword) {
        return new Response(JSON.stringify({ error: "请输入关键词" }), { status: 400 });
      }

      try {
        const results = await fetchAllRealEngines(keyword, engine);
        return new Response(JSON.stringify(results), {
          headers: { 
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

// 后端高并发抓取与深度清洗去重
async function fetchAllRealEngines(keyword, selectedEngine) {
  const encoded = encodeURIComponent(keyword);
  
  // 伪装成标准的移动端浏览器（Via/Chrome），让各大引擎吐出最易解析的数据结构
  const mobileUA = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36";
  const fetchHeaders = { "User-Agent": mobileUA };

  // --- 1. 必应搜索 ---
  const fetchBing = async () => {
    try {
      const res = await fetch(`https://cn.bing.com/search?q=${encoded}`, { headers: fetchHeaders });
      const html = await res.text();
      return parseBing(html);
    } catch { return []; }
  };

  // --- 2. 神马搜索 ---
  const fetchSM = async () => {
    try {
      const res = await fetch(`https://m.sm.cn/s?q=${encoded}`, { headers: fetchHeaders });
      const html = await res.text();
      return parseSM(html);
    } catch { return []; }
  };

  // --- 3. 百度搜索 ---
  const fetchBaidu = async () => {
    try {
      const res = await fetch(`https://m.baidu.com/s?word=${encoded}`, { headers: fetchHeaders });
      const html = await res.text();
      return parseBaidu(html);
    } catch { return []; }
  };

  // --- 4. 搜狗搜索 ---
  const fetchSogou = async () => {
    try {
      const res = await fetch(`https://wap.sogou.com/web/sl?keyword=${encoded}`, { headers: fetchHeaders });
      const html = await res.text();
      return parseSogou(html);
    } catch { return []; }
  };

  // --- 5. 360搜索 ---
  const fetch360 = async () => {
    try {
      const res = await fetch(`https://m.so.com/s?q=${encoded}`, { headers: fetchHeaders });
      const html = await res.text();
      return parse360(html);
    } catch { return []; }
  };

  let rawList = [];

  // 分流处理：用户选哪个就抓哪个，选“混合”就全部并发抓取
  if (selectedEngine === "bing") rawList = await fetchBing();
  else if (selectedEngine === "sm") rawList = await fetchSM();
  else if (selectedEngine === "baidu") rawList = await fetchBaidu();
  else if (selectedEngine === "sogou") rawList = await fetchSogou();
  else if (selectedEngine === "so") rawList = await fetch360();
  else {
    // 聚合模式：5路并发并行发出，速度取决于最慢的那个响应，做到极致的高效快速
    const [bing, sm, baidu, sogou, so] = await Promise.all([
      fetchBing(), fetchSM(), fetchBaidu(), fetchSogou(), fetch360()
    ]);
    rawList = [...bing, ...sm, ...baidu, ...sogou, ...so];
  }

  // --- 严苛清洗去重与广告拦截逻辑 ---
  const seenUrls = new Set();
  const cleanResults = [];

  for (const item of rawList) {
    // 粗暴直接：如果包含各家引擎的商业广告标签，或者带有“广告/推广”字样，直接不要
    if (item.isAd || item.title.includes("广告") || item.title.includes("推广") || item.snippet.includes("广告")) {
      continue;
    }

    // 标准化 URL 去重：丢弃查询参数、去尾斜杠，小写化。确保相同的网页在前端只展示一次
    let normalizedUrl = item.url.split('?')[0].replace(/\/$/, "").toLowerCase();
    
    if (!seenUrls.has(normalizedUrl) && normalizedUrl.startsWith("http")) {
      seenUrls.add(normalizedUrl);
      cleanResults.push(item);
    }
  }

  return cleanResults;
}

// ======================== 各大引擎真实 HTML 解析器 ========================

function parseBing(html) {
  const results = [];
  const matches = html.matchAll(/<li class="b_algo">([\s\S]*?)<\/li>/g);
  for (const match of matches) {
    const block = match[1];
    const titleM = block.match(/<h2><a[^>]*>([\s\S]*?)<\/a>/);
    const urlM = block.match(/href="([^"]*)"/);
    const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/) || block.match(/<div class="b_caption">([\s\S]*?)<\/div>/);

    if (titleM && urlM) {
      results.push({
        source: "必应",
        title: cleanTags(titleM[1]),
        url: urlM[1],
        snippet: snippetM ? cleanTags(snippetM[1]) : "点击直接访问原站干净内容...",
        isAd: block.includes("b_ad")
      });
    }
  }
  return results;
}

function parseSM(html) {
  const results = [];
  const matches = html.matchAll(/<div class="card-title">([\s\S]*?)<\/div>\s*<\/div>/g);
  for (const match of matches) {
    const block = match[1];
    const titleM = block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    const urlM = block.match(/href="([^"]*)"/);
    if (titleM && urlM) {
      results.push({
        source: "神马",
        title: cleanTags(titleM[1]),
        url: urlM[1].startsWith('http') ? urlM[1] : 'https://m.sm.cn' + urlM[1],
        snippet: "源自神马UC纯净推荐，无跳转直接阅览。",
        isAd: block.includes("ad-tag")
      });
    }
  }
  return results;
}

function parseBaidu(html) {
  const results = [];
  const matches = html.matchAll(/<div class="[^"]*c-result-content[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g);
  for (const match of matches) {
    const block = match[1];
    const titleM = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const urlM = block.match(/href="([^"]*)"/);
    const snippetM = block.match(/<span class="[^"]*c-color-gray[^"]*">([\s\S]*?)<\/span>/) || block.match(/<div class="[^"]*c-abstract[^"]*">([\s\S]*?)<\/div>/);

    if (titleM && urlM) {
      results.push({
        source: "百度",
        title: cleanTags(titleM[1]),
        url: urlM[1].startsWith('http') ? urlM[1] : 'https://m.baidu.com' + urlM[1],
        snippet: snippetM ? cleanTags(snippetM[1]) : "打开网页直接查阅详情。",
        isAd: block.includes("ec_res") || block.includes("data-is-ad")
      });
    }
  }
  return results;
}

function parseSogou(html) {
  const results = [];
  const matches = html.matchAll(/<div class="[^"]*vr-wrapper[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g);
  for (const match of matches) {
    const block = match[1];
    const titleM = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || block.match(/<a class="[^"]*title[^"]*">([\s\S]*?)<\/a>/);
    const urlM = block.match(/href="([^"]*)"/);
    const snippetM = block.match(/<p class="[^"]*summary[^"]*">([\s\S]*?)<\/p>/) || block.match(/<div class="[^"]*abstract[^"]*">([\s\S]*?)<\/div>/);

    if (titleM && urlM) {
      results.push({
        source: "搜狗",
        title: cleanTags(titleM[1]),
        url: urlM[1].startsWith('http') ? urlM[1] : 'https://wap.sogou.com' + urlM[1],
        snippet: snippetM ? cleanTags(snippetM[1]) : "多路并发抓取，去重去广告呈现。",
        isAd: block.includes("product-ad") || block.includes("adv-tag")
      });
    }
  }
  return results;
}

function parse360(html) {
  const results = [];
  const matches = html.matchAll(/<li class="[^"]*res-list[^"]*">([\s\S]*?)<\/li>/g);
  for (const match of matches) {
    const block = match[1];
    const titleM = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const urlM = block.match(/href="([^"]*)"/);
    const snippetM = block.match(/<div class="[^"]*res-desc[^"]*">([\s\S]*?)<\/div>/);

    if (titleM && urlM) {
      results.push({
        source: "360",
        title: cleanTags(titleM[1]),
        url: urlM[1],
        snippet: snippetM ? cleanTags(snippetM[1]) : "点击直接进入目标页查看。",
        isAd: block.includes("b_ad") || block.includes("mediav")
      });
    }
  }
  return results;
}

function cleanTags(str) {
  return str.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ======================== 纯正搜索引擎风格前端 UI ========================
function getEngineUI() {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>混合搜索 - 聚合纯净版</title>
      <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #202124; }
          
          /* 顶部搜索横条区域（完全贴合常规搜索引擎结构） */
          .header-search-bar { display: flex; align-items: center; padding: 15px 40px; border-bottom: 1px solid #f1f3f4; background: #fff; position: sticky; top: 0; z-index: 100; gap: 20px; }
          .logo { font-size: 22px; font-weight: bold; color: #4285f4; cursor: pointer; text-decoration: none; white-space: nowrap; }
          .logo span { color: #ea4335; }
          .input-box-wrap { display: flex; flex: 1; max-width: 650px; border: 1px solid #dfe1e5; box-shadow: 0 1px 6px rgba(32,33,36,0.1); border-radius: 24px; padding: 2px 8px 2px 18px; overflow: hidden; background: #fff; }
          .input-box-wrap:hover { box-shadow: 0 1px 6px rgba(32,33,36,0.2); border-color: rgba(223,225,229,0); }
          input[type="text"] { flex: 1; border: none; padding: 10px 0; font-size: 16px; outline: none; color: #000; }
          .search-btn { background: none; border: none; cursor: pointer; padding: 0 15px; color: #4285f4; font-size: 16px; font-weight: bold; }
          
          /* 引擎切换页签 */
          .tabs-container { display: flex; padding: 0 40px 10px 140px; border-bottom: 1px solid #f1f3f4; gap: 20px; font-size: 14px; color: #5f6368; background: #fff; }
          .tabs-container label { display: flex; align-items: center; gap: 5px; cursor: pointer; padding-bottom: 5px; border-bottom: 3px solid transparent; }
          .tabs-container input[type="radio"] { display: none; }
          .tabs-container label:has(input:checked) { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: bold; }

          /* 主体结果布局：靠左对齐，标准的 650px 宽度限制 */
          .main-content { padding: 20px 40px 40px 140px; max-width: 650px; }
          .loading-status { display: none; font-size: 15px; color: #70757a; margin-top: 20px; }
          
          /* 核心搜索条目卡片 */
          .search-item { margin-bottom: 28px; font-size: 14px; line-height: 1.54; word-wrap: break-word; }
          .item-site-info { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #202124; margin-bottom: 4px; }
          .source-badge { background: #f1f3f4; color: #5f6368; padding: 1px 6px; border-radius: 4px; font-weight: 500; font-size: 11px; }
          .item-url { color: #202124; text-decoration: none; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .item-title { font-size: 20px; color: #1a0dab; text-decoration: none; display: inline-block; margin-bottom: 4px; font-weight: 400; }
          .item-title:hover { text-decoration: underline; }
          .item-snippet { color: #4d5156; }
          
          /* 移动端自适应适配 */
          @media (max-width: 768px) {
              .header-search-bar { padding: 10px 15px; flex-direction: column; align-items: stretch; gap: 10px; }
              .tabs-container { padding: 10px 15px; overflow-x: auto; white-space: nowrap; }
              .main-content { padding: 15px; }
              .item-title { font-size: 18px; }
          }
      </style>
  </head>
  <body>

      <div class="header-search-bar">
          <a class="logo" href="/">混合<span>搜索</span></a>
          <div class="input-box-wrap">
              <input type="text" id="query-input" placeholder="输入关键词，直接回车搜索..." value="测试">
              <button class="search-btn" onclick="triggerSearch()">搜索</button>
          </div>
      </div>

      <div class="tabs-container">
          <label><input type="radio" name="engine" value="mixed" checked>🌀 混合聚合</label>
          <label><input type="radio" name="engine" value="bing">必应搜索</label>
          <label><input type="radio" name="engine" value="sm">神马搜索</label>
          <label><input type="radio" name="engine" value="baidu">百度搜索</label>
          <label><input type="radio" name="engine" value="sogou">搜狗搜索</label>
          <label><input type="radio" name="engine" value="so">360搜索</label>
      </div>

      <div class="main-content">
          <div id="loading" class="loading-status">正在并行向各大源请求并清洗数据，请稍候...</div>
          <div id="result-box"></div>
      </div>

      <script>
          async function triggerSearch() {
              const q = document.getElementById('query-input').value.trim();
              if(!q) return;

              const activeEngine = document.querySelector('input[name="engine"]:checked').value;
              const loader = document.getElementById('loading');
              const box = document.getElementById('result-box');
              
              loader.style.display = 'block';
              box.innerHTML = '';

              try {
                  const apiResponse = await fetch(\`/api/search?q=\${encodeURIComponent(q)}&engine=\${activeEngine}\`);
                  const items = await apiResponse.json();
                  loader.style.display = 'none';

                  if (items.error) {
                      box.innerHTML = \`<div style="color:red;padding:20px;">错误: \${items.error}</div>\`;
                      return;
                  }

                  if (items.length === 0) {
                      box.innerHTML = '<div style="color:#70757a;padding:20px;">未找到相关纯净搜索结果</div>';
                      return;
                  }

                  // 纯粹的搜索引擎结果卡片组装（无跳转渲染在当前页）
                  box.innerHTML = items.map(node => \`
                      <div class="search-item">
                          <div class="item-site-info">
                              <span class="source-badge">\${node.source}</span>
                              <span class="item-url">\${node.url}</span>
                          </div>
                          <a class="item-title" href="\${node.url}" target="_blank">\${node.title}</a>
                          <div class="item-snippet">\${node.snippet}</div>
                      </div>
                  \`).join('');

              } catch(e) {
                  loader.style.display = 'none';
                  box.innerHTML = '<div style="color:red;padding:20px;">后端聚合链路反代请求异常，请稍后再试。</div>';
              }
          }

          // 回车键绑定
          document.getElementById('query-input').addEventListener('keypress', function(e) {
              if (e.key === 'Enter') triggerSearch();
          });
          
          // 切换页签自动触发搜索
          document.querySelectorAll('input[name="engine"]').forEach(radio => {
              radio.addEventListener('change', () => triggerSearch());
          });

          // 初始化直接加载“测试”结果
          window.onload = () => { triggerSearch(); };
      </script>
  </body>
  </html>
  `;
}