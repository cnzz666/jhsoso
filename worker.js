export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由1：渲染高颜值、标准的搜索引擎风格前端单页
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(getEngineUI(), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    // 路由2：后端真正的 HTMLRewriter 聚合反代接口
    if (url.pathname === "/api/search") {
      const keyword = url.searchParams.get("q") || "";
      const engine = url.searchParams.get("engine") || "mixed";
      
      if (!keyword) {
        return new Response(JSON.stringify({ error: "请输入关键词" }), { status: 400 });
      }

      try {
        const results = await fetchAndStreamParse(keyword, engine);
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

// 使用 HTMLRewriter 强力流解析，彻底告别脆弱的正则
async function fetchAndStreamParse(keyword, selectedEngine) {
  const encoded = encodeURIComponent(keyword);
  const mobileUA = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36";
  const headers = { "User-Agent": mobileUA };

  // --- 1. 必应解析器（通过 HTMLRewriter 核心驱动，极度稳定） ---
  const fetchBing = async () => {
    try {
      const res = await fetch(`https://cn.bing.com/search?q=${encoded}`, { headers });
      let results = [];
      let current = null;

      const rewriter = new HTMLRewriter()
        .on('li.b_algo', {
          element() {
            if (current && current.title) results.push(current);
            current = { source: "必应", title: "", url: "", snippet: "" };
          }
        })
        .on('li.b_algo h2 a', {
          element(el) { if (current) current.url = el.getAttribute('href') || ''; },
          text(t) { if (current) current.title += t.text; }
        })
        .on('li.b_algo .b_caption p, li.b_algo .b_algo_text', {
          text(t) { if (current) current.snippet += t.text; }
        });

      await rewriter.transform(res).text(); // 强制消耗流以触发解析
      if (current && current.title) results.push(current);
      return results;
    } catch { return []; }
  };

  // --- 2. 百度解析器 ---
  const fetchBaidu = async () => {
    try {
      const res = await fetch(`https://m.baidu.com/s?word=${encoded}`, { headers });
      let results = [];
      let current = null;

      const rewriter = new HTMLRewriter()
        .on('div.c-result-content', {
          element() {
            if (current && current.title) results.push(current);
            current = { source: "百度", title: "", url: "", snippet: "" };
          }
        })
        .on('div.c-result-content h3 a', {
          element(el) { 
            let href = el.getAttribute('href') || '';
            if (href && !href.startsWith('http')) href = 'https://m.baidu.com' + href;
            if (current) current.url = href; 
          }
        })
        .on('div.c-result-content h3', {
          text(t) { if (current) current.title += t.text; }
        })
        .on('div.c-result-content .c-color-gray, div.c-result-content .c-abstract', {
          text(t) { if (current) current.snippet += t.text; }
        });

      await rewriter.transform(res).text();
      if (current && current.title) results.push(current);
      return results;
    } catch { return []; }
  };

  // --- 3. 360 搜索解析器 ---
  const fetch360 = async () => {
    try {
      const res = await fetch(`https://m.so.com/s?q=${encoded}`, { headers });
      let results = [];
      let current = null;

      const rewriter = new HTMLRewriter()
        .on('li.res-list', {
          element() {
            if (current && current.title) results.push(current);
            current = { source: "360", title: "", url: "", snippet: "" };
          }
        })
        .on('li.res-list h3 a', {
          element(el) { if (current) current.url = el.getAttribute('href') || ''; },
          text(t) { if (current) current.title += t.text; }
        })
        .on('li.res-list .res-desc', {
          text(t) { if (current) current.snippet += t.text; }
        });

      await rewriter.transform(res).text();
      if (current && current.title) results.push(current);
      return results;
    } catch { return []; }
  };

  // --- 4. 搜狗搜索解析器 ---
  const fetchSogou = async () => {
    try {
      const res = await fetch(`https://wap.sogou.com/web/sl?keyword=${encoded}`, { headers });
      let results = [];
      let current = null;

      const rewriter = new HTMLRewriter()
        .on('div.vr-wrapper, div.results', {
          element() {
            if (current && current.title) results.push(current);
            current = { source: "搜狗", title: "", url: "", snippet: "" };
          }
        })
        .on('div.vr-wrapper h3 a, div.results h3 a', {
          element(el) { 
            let href = el.getAttribute('href') || '';
            if (href && !href.startsWith('http')) href = 'https://wap.sogou.com' + href;
            if (current) current.url = href; 
          },
          text(t) { if (current) current.title += t.text; }
        })
        .on('div.vr-wrapper .summary, div.results .abstract', {
          text(t) { if (current) current.snippet += t.text; }
        });

      await rewriter.transform(res).text();
      if (current && current.title) results.push(current);
      return results;
    } catch { return []; }
  };

  // --- 5. 神马搜索解析器 ---
  const fetchSM = async () => {
    try {
      const res = await fetch(`https://m.sm.cn/s?q=${encoded}`, { headers });
      let results = [];
      let current = null;

      const rewriter = new HTMLRewriter()
        .on('div.card', {
          element() {
            if (current && current.title) results.push(current);
            current = { source: "神马", title: "", url: "", snippet: "" };
          }
        })
        .on('div.card .card-title a, div.card h3 a', {
          element(el) { 
            let href = el.getAttribute('href') || '';
            if (href && !href.startsWith('http')) href = 'https://m.sm.cn' + href;
            if (current) current.url = href; 
          },
          text(t) { if (current) current.title += t.text; }
        })
        .on('div.card .card-abstract, div.card .sc-content', {
          text(t) { if (current) current.snippet += t.text; }
        });

      await rewriter.transform(res).text();
      if (current && current.title) results.push(current);
      return results;
    } catch { return []; }
  };

  let rawList = [];

  // 根据前端选则的分流执行
  if (selectedEngine === "bing") rawList = await fetchBing();
  else if (selectedEngine === "baidu") rawList = await fetchBaidu();
  else if (selectedEngine === "so") rawList = await fetch360();
  else if (selectedEngine === "sogou") rawList = await fetchSogou();
  else if (selectedEngine === "sm") rawList = await fetchSM();
  else {
    // 混合模式：5路大并发异步齐发
    const [bing, baidu, so, sogou, sm] = await Promise.all([
      fetchBing(), fetchBaidu(), fetch360(), fetchSogou(), fetchSM()
    ]);
    rawList = [...bing, ...baidu, ...so, ...sogou, ...sm];
  }

  // 后端严苛去重、清洗格式、强力剔除广告
  const seenUrls = new Set();
  const cleanResults = [];

  for (const item of rawList) {
    // 基础文本清理
    item.title = item.title.replace(/\s+/g, " ").trim();
    item.snippet = item.snippet.replace(/\s+/g, " ").trim() || "点击直接进入目标原站查阅详情...";

    // 拦截带有明显广告、推广特征的脏条目
    if (item.title.includes("广告") || item.title.includes("推广") || item.snippet.includes("广告")) {
      continue;
    }

    if (!item.title || !item.url) continue;

    // URL 归一化去重（砍掉各种小尾巴参数，防止同一个网页因为追踪参数反复出现）
    let cleanUrl = item.url.split('?')[0].replace(/\/$/, "").toLowerCase();
    
    if (!seenUrls.has(cleanUrl) && cleanUrl.startsWith("http")) {
      seenUrls.add(cleanUrl);
      cleanResults.push(item);
    }
  }

  return cleanResults;
}

// ======================== 标准搜索引擎视觉前端 UI ========================
function getEngineUI() {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>混合搜索 - 聚合纯净版</title>
      <style>
          body { font-family: -apple-system, system-ui, Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #202124; }
          
          /* 顶部固定搜索大栏 */
          .search-header { display: flex; align-items: center; padding: 20px 40px 15px 40px; border-bottom: 1px solid #f1f3f4; background: #fff; position: sticky; top: 0; z-index: 100; gap: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #4285f4; text-decoration: none; white-space: nowrap; }
          .logo span { color: #ea4335; }
          .search-input-wrap { display: flex; flex: 1; max-width: 650px; border: 1px solid #dfe1e5; box-shadow: 0 1px 6px rgba(32,33,36,0.1); border-radius: 24px; padding: 4px 8px 4px 20px; background: #fff; }
          .search-input-wrap:hover { box-shadow: 0 1px 6px rgba(32,33,36,0.2); }
          input[type="text"] { flex: 1; border: none; font-size: 16px; outline: none; background: transparent; }
          .search-btn { background: none; border: none; cursor: pointer; padding: 0 10px; color: #4285f4; font-size: 16px; font-weight: bold; }
          
          /* 搜索引擎切换 Tabs 贴合在输入框垂直下方 */
          .nav-tabs { display: flex; padding: 0 40px 12px 145px; border-bottom: 1px solid #f1f3f4; gap: 24px; font-size: 14px; color: #5f6368; background: #fff; }
          .nav-tabs label { display: flex; align-items: center; gap: 4px; cursor: pointer; padding-bottom: 6px; border-bottom: 3px solid transparent; transition: all 0.15s; }
          .nav-tabs input[type="radio"] { display: none; }
          .nav-tabs label:has(input:checked) { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: bold; }

          /* 结果展示主体布局：完美的经典搜索视窗（限制在650px宽度，阅读最舒适） */
          .results-container { padding: 25px 40px 40px 145px; max-width: 650px; }
          .status-info { display: none; font-size: 14px; color: #70757a; margin-bottom: 20px; animation: blink 1.5s infinite; }
          
          /* 结构化单条结果条目 */
          .item { margin-bottom: 30px; font-size: 14px; line-height: 1.58; word-wrap: break-word; }
          .item-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 4px; }
          .source-badge { background: #f1f3f4; color: #5f6368; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; text-transform: uppercase; }
          .item-link { color: #202124; text-decoration: none; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .item-title { font-size: 19px; color: #1a0dab; text-decoration: none; display: inline-block; margin-bottom: 5px; font-weight: 400; }
          .item-title:hover { text-decoration: underline; }
          .item-snippet { color: #4d5156; text-align: justify; }

          @keyframes blink { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }
          
          /* 移动端极简自适应 */
          @media (max-width: 768px) {
              .search-header { padding: 12px 15px; flex-direction: column; align-items: stretch; gap: 8px; }
              .nav-tabs { padding: 8px 15px; overflow-x: auto; white-space: nowrap; }
              .results-container { padding: 15px; }
              .item-title { font-size: 17px; }
          }
      </style>
  </head>
  <body>

      <div class="search-header">
          <a class="logo" href="/">混合<span>搜索</span></a>
          <div class="search-input-wrap">
              <input type="text" id="keyword-field" placeholder="一键聚合检索全网..." value="测试">
              <button class="search-btn" onclick="executeSearch()">搜索</button>
          </div>
      </div>

      <div class="nav-tabs">
          <label><input type="radio" name="engine" value="mixed" checked>🌀 混合聚合搜索</label>
          <label><input type="radio" name="engine" value="bing">必应原网</label>
          <label><input type="radio" name="engine" value="baidu">百度原网</label>
          <label><input type="radio" name="engine" value="so">360搜索</label>
          <label><input type="radio" name="engine" value="sogou">搜狗搜索</label>
          <label><input type="radio" name="engine" value="sm">神马搜索</label>
      </div>

      <div class="results-container">
          <div id="status-bar" class="status-info">正在通过 Cloudflare HTMLRewriter 并发清洗数据流...</div>
          <div id="output-box"></div>
      </div>

      <script>
          async function executeSearch() {
              const q = document.getElementById('keyword-field').value.trim();
              if(!q) return;

              const activeEngine = document.querySelector('input[name="engine"]:checked').value;
              const statusBar = document.getElementById('status-bar');
              const outputBox = document.getElementById('output-box');
              
              statusBar.style.display = 'block';
              outputBox.innerHTML = '';

              try {
                  const apiRes = await fetch(\`/api/search?q=\${encodeURIComponent(q)}&engine=\${activeEngine}\`);
                  const dataList = await apiRes.json();
                  statusBar.style.display = 'none';

                  if (dataList.error) {
                      outputBox.innerHTML = \`<div style="color:red; font-size:14px;">接口返回异常: \${dataList.error}</div>\`;
                      return;
                  }

                  if (dataList.length === 0) {
                      outputBox.innerHTML = \`<div style="color:#70757a; font-size:14px;">
                          未检索到匹配的纯净结果。这通常是由于国内引擎触发了 Cloudflare 节点的安全验证码阻断。<br><br>
                          💡 <b>提示：</b>建议点击上方切换到 <b>“必应原网”</b>，该引擎在云端最为稳定可靠，能百分之百拉取结果。
                      </div>\`;
                      return;
                  }

                  // 像真实搜索引擎一样，在当前页优雅呈现结果，零跳转
                  outputBox.innerHTML = dataList.map(item => \`
                      <div class="item">
                          <div class="item-meta">
                              <span class="source-badge">\${item.source}</span>
                              <span class="item-link">\${item.url}</span>
                          </div>
                          <a class="item-title" href="\${item.url}" target="_blank">\${item.title}</a>
                          <div class="item-snippet">\${item.snippet}</div>
                      </div>
                  \`).join('');

              } catch(e) {
                  statusBar.style.display = 'none';
                  outputBox.innerHTML = '<div style="color:red; font-size:14px;">网络发生故障，边缘计算集群无法与远端引擎握手。</div>';
              }
          }

          // 绑定键盘回车
          document.getElementById('keyword-field').addEventListener('keypress', function(e) {
              if (e.key === 'Enter') executeSearch();
          });
          
          // 点击标签直接触发检索
          document.querySelectorAll('input[name="engine"]').forEach(r => {
              r.addEventListener('change', () => executeSearch());
          });

          // 初始化加载默认首屏
          window.onload = () => { executeSearch(); };
      </script>
  </body>
  </html>
  `;
}