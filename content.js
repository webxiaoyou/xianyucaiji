/**
 * 监听来自popup的消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === 'collect') {
		// 使用立即执行的异步函数包装
		(async () => {
			try {
				const links = await collectProductLinks(
					true,
					request.pageCount,
					request.keyword,
					request.collectDetail,
					request.concurrentCount,
					request.exportType || 'csv'
				);
				// 确保在清理之前发送响应
				sendResponse({
					links,
					success: true
				});
			} catch (error) {
				console.error('采集错误:', error);
				sendResponse({
					success: false,
					error: error.message
				});
			}
		})();
		return true; // 保持消息通道开启
	} else if (request.action === 'search') {
		(async () => {
			try {
				await performSearch(request.keyword);
				sendResponse({
					success: true
				});
			} catch (error) {
				console.error('搜索错误:', error);
				sendResponse({
					success: false,
					error: error.message
				});
			}
		})();
		return true;
	} else if (request.action === 'ping') {
		sendResponse({
			status: 'ok'
		});
		return false; // 同步响应，不需要保持通道开启
	}
});

/**
 * 等待元素出现
 * @param {string} selector - CSS选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element[]>}
 */
function waitForElements(selector, timeout = 5000) {
	return new Promise((resolve) => {
		if (document.querySelectorAll(selector).length > 0) {
			resolve(Array.from(document.querySelectorAll(selector)));
			return;
		}

		const observer = new MutationObserver((mutations, obs) => {
			const elements = document.querySelectorAll(selector);
			if (elements.length > 0) {
				obs.disconnect();
				resolve(Array.from(elements));
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		// 设置超时
		setTimeout(() => {
			observer.disconnect();
			resolve([]);
		}, timeout);
	});
}

/**
 * 采集当前页面的商品链接
 * @returns {Promise<Array>} 商品链接数组
 */
async function collectCurrentPageLinks() {
	const selectors = [
		'.search-container--eigqxPi6 .feeds-list-container--UkIMBPNk > a',
		'.feeds-list-container--UkIMBPNk > a',
		'div[class*="search-container"] div[class*="feeds-list-container"] > a',
		'div[class*="feeds-list-container"] > a',
		'a[href*="item"]',
		'a[href*="detail"]'
	];

	// 等待页面加载并滚动
	await new Promise(resolve => setTimeout(resolve, 1500));
	window.scrollTo(0, document.body.scrollHeight / 2);
	await new Promise(resolve => setTimeout(resolve, 1000));

	// 采集当前页面的链接和封面
	for (const selector of selectors) {
		const elements = document.querySelectorAll(selector);
		if (elements.length > 0) {
			return Array.from(elements)
				.map(link => {
					// 提取封面图片
					let coverImage = '';
					const imgElement = link.querySelector('img');
					if (imgElement) {
						// 优先获取 data-src 或 src 属性
						coverImage = imgElement.dataset.src || imgElement.src || '';
					}

					return {
						url: link.href,
						coverImage: coverImage
					};
				})
				.filter(item => {
					return item.url &&
						item.url.length > 0 &&
						(item.url.includes('item') || item.url.includes('detail')) &&
						!item.url.includes('javascript:') &&
						!item.url.includes('#');
				});
		}
	}

	return [];
}

/**
 * 跳转到下一页
 * @returns {Promise<boolean>} 是否成功跳转
 */
async function goToNextPage() {
	try {
		// 滚动到底部以确保分页器加载
		window.scrollTo(0, document.body.scrollHeight);
		await new Promise(resolve => setTimeout(resolve, 1500));

		// 闲鱼的分页按钮选择器
		const nextPageSelectors = [
			'.search-footer-page-container--e02TuanR .search-pagination-pageitem-container--adfiUKZP > button:last-child',
			'button[class*="next"]',
			'button[class*="pagination"][class*="next"]',
			'button.next-btn',
			'button[aria-label="下一页"]'
		];

		// 尝试所有可能的选择器
		for (const selector of nextPageSelectors) {
			const nextButton = document.querySelector(selector);
			if (nextButton) {
				console.log('找到下一页按钮:', {
					text: nextButton.textContent,
					disabled: nextButton.disabled,
					className: nextButton.className
				});

				if (!nextButton.disabled) {
					nextButton.click();
					console.log('已点击下一页按钮');

					// 等待页面加载
					await new Promise(resolve => setTimeout(resolve, 2000));

					// 滚动回顶部
					window.scrollTo(0, 0);
					await new Promise(resolve => setTimeout(resolve, 1000));

					return true;
				} else {
					console.log('下一页按钮已禁用');
				}
			}
		}

		console.log('未找到可用的下一页按钮');
		return false;
	} catch (error) {
		console.error('翻页失败:', error);
		return false;
	}
}

/**
 * 执行搜索
 * @param {string} keyword - 搜索关键词
 */
async function performSearch(keyword) {
	try {
		// 获取搜索输入框
		const searchInput = document.querySelector(
			'input[type="search"], input[placeholder*="搜索"], input.search-input');
		if (searchInput) {
			// 模拟用户输入
			searchInput.value = keyword;
			searchInput.dispatchEvent(new Event('input', {
				bubbles: true
			}));
			searchInput.dispatchEvent(new Event('change', {
				bubbles: true
			}));

			// 模拟回车搜索
			searchInput.dispatchEvent(new KeyboardEvent('keypress', {
				key: 'Enter',
				code: 'Enter',
				keyCode: 13,
				bubbles: true
			}));
		} else {
			// 如果找不到搜索框，直接跳转
			window.location.href = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;
		}
	} catch (error) {
		console.error('搜索失败:', error);
	}
}

/**
 * 在新标签页中采集商品详情
 * @param {string} url - 商品链接
 * @returns {Promise<Object>} 商品详情
 */
async function fetchProductDetail(url) {
	try {
		console.log('开始获取商品详情:', url);

		const response = await new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({
				action: 'fetchDetail',
				url: url
			}, (response) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve(response);
				}
			});
		});

		console.log('获取到详情响应:', response);

		if (!response) {
			throw new Error('未收到响应');
		}

		if (response.success) {
			const details = response.details;
			const allEmpty = Object.values(details).every(value => !value);

			return {
				url,
				...details,
				status: allEmpty ? 'failed' : 'success'
			};
		} else {
			throw new Error(response.error || '获取详情失败');
		}
	} catch (error) {
		console.error(`采集商品详情失败 ${url}:`, error);
		return {
			url,
			location: '',
			wantCount: '',
			viewCount: '',
			price: '',
			shopName: '',
			description: '',
			status: 'failed',
			error: error.message
		};
	}
}

/**
 * 清理数据值
 * @param {string} value - 原始值
 * @param {string} type - 值类型
 * @returns {string} 处理后的值
 */
function cleanValue(value, type) {
	if (!value) return 'null';

	// 通用数字提取函数：匹配数字（支持整数/小数）和可能的"万"单位
	const extractNumber = (str) => {
		// 匹配数字（可选小数）+ 可选"万"字（忽略中间的空格或其他字符）
		const match = str.match(/(\d+(?:\.\d+)?)\s*万?/);
		if (!match) return null;

		const num = parseFloat(match[1]);
		// 判断是否包含"万"单位（不严格匹配位置，只要字符串中存在"万"即可）
		const hasWan = str.includes('万');
		return hasWan ? num * 10000 : num;
	};

	switch (type) {
		case 'wantCount': {
			const number = extractNumber(value);
			return number !== null ? number.toString() : 'null';
		}
		case 'coverImage': {
			// 处理图片链接，移除可能的尺寸参数
			const cleaned = value.split('?')[0];
			return cleaned || 'null';
		}
		case 'viewCount': {
			const number = extractNumber(value);
			return number !== null ? number.toString() : 'null';
		}
		case 'price': {
			const cleaned = value.replace(/[¥￥]/, '').trim();
			return cleaned || 'null';
		}
		case 'description': {
			return value.replace(/[\r\n]+/g, ' ').trim() || 'null';
		}
		default:
			return value.trim() || 'null';
	}
}

/**
 * 导出为CSV文件
 * @param {Array} products - 商品数据数组
 * @param {string} keyword - 搜索关键词
 * @param {boolean} withDetails - 是否包含详情
 */
function exportToCSV(products, keyword, withDetails = true) {
	try {
		// 根据是否包含详情决定表头
		const headers = withDetails ? ['序号', '商品封面', '商品链接', '发布地', '想要数', '浏览量', '价格', '店铺名称', '产品文案'] : ['序号', '商品封面',
			'商品链接'
		];

		const rows = [headers];

		products.forEach((product, index) => {
			if (withDetails) {
				rows.push([
					(index + 1).toString(),
					cleanValue(product.coverImage, 'coverImage'), // 商品封面
					product.url,
					cleanValue(product.location),
					cleanValue(product.wantCount, 'wantCount'),
					cleanValue(product.viewCount, 'viewCount'),
					cleanValue(product.price, 'price'),
					cleanValue(product.shopName),
					cleanValue(product.description, 'description')
				]);
			} else {
				rows.push([
					(index + 1).toString(),
					cleanValue(product.coverImage, 'coverImage'), // 商品封面
					product.url
				]);
			}
		});

		const csvContent = rows
			.map(row => row.map(cell => `"${cell}"`).join(','))
			.join('\n');

		const blob = new Blob(['\ufeff' + csvContent], {
			type: 'text/csv;charset=utf-8;'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

		link.setAttribute('href', url);
		link.setAttribute('download', `闲鱼-${keyword}-${timestamp}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	} catch (error) {
		console.error('导出CSV文件失败:', error);
	}
}

/**
 * 添加日志发送函数
 * @param {string} message - 日志消息
 */
function sendLog(message) {
	chrome.runtime.sendMessage({
		action: 'log',
		message: message
	});
}

/**
 * 发送进度
 */
function sendProgress(current, total, status) {
	chrome.runtime.sendMessage({
		action: 'progress',
		current,
		total,
		status
	});
}

/**
 * 将图片URL转为dataURL（失败则回退为原URL）
 */
async function toDataURL(url) {
	try {
		const res = await fetch(url, { mode: 'cors' });
		const blob = await res.blob();
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => resolve(url);
			reader.readAsDataURL(blob);
		});
	} catch (e) {
		return url;
	}
}

const __OSS_TOKEN = "OSS-NOTICE-3E5F8A7C-2025-09";
/**
 * 强制开源告知校验：校验 manifest 与 NOTICE.txt
 * 不通过将抛错，阻断采集流程
 */
async function __verifyNotice() {
	const mf = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
	if (!mf || mf.x_oss_notice !== __OSS_TOKEN) {
		throw new Error("OSS Notice missing or changed");
	}
	try {
		const res = await fetch(chrome.runtime.getURL("NOTICE.txt"));
		const txt = await res.text();
		if (!txt || !txt.includes(__OSS_TOKEN)) {
			throw new Error("OSS Notice mismatch");
		}
	} catch (_) {
		throw new Error("OSS Notice check failed");
	}
}

/**
 * 导出为HTML（增强版：表格美化 + 过滤 + 图片放大 + 文案折叠/弹窗 + 排序）
 */
async function exportToHTML(products, keyword, withDetails = true) {
  const headers = withDetails
    ? ['序号', '商品封面', '商品链接', '发布地', '想要数', '浏览量', '价格', '店铺名称', '产品文案']
    : ['序号', '商品封面', '商品链接'];

  const coverList = await Promise.all(products.map(p => p.coverImage ? toDataURL(p.coverImage) : ''));

  const rowsHtml = products.map((p, i) => {
    const cover = coverList[i] || '';
    const want = parseFloat(cleanValue(p.wantCount || '', 'wantCount'));
    const view = parseFloat(cleanValue(p.viewCount || '', 'viewCount'));
    const price = parseFloat(cleanValue(p.price || '', 'price'));
    if (withDetails) {
      return `<tr class="data-row" data-want="${isNaN(want) ? '' : want}" data-view="${isNaN(view) ? '' : view}" data-price="${isNaN(price) ? '' : price}">
  <td class="index-cell">${i + 1}</td>
  <td class="cover-cell">
    <div class="cover-box"><img src="${cover}" alt="cover" class="thumb"/></div>
  </td>
  <td class="link-cell"><a href="${p.url}" target="_blank">${p.url}</a></td>
  <td>${cleanValue(p.location || '', '')}</td>
  <td class="num want">${isNaN(want) ? '' : want}</td>
  <td class="num view">${isNaN(view) ? '' : view}</td>
  <td class="num price">${isNaN(price) ? '' : price}</td>
  <td>${cleanValue(p.shopName || '', '')}</td>
  <td class="desc-cell"><div class="desc clamp">${cleanValue(p.description || '', 'description')}</div><button type="button" class="link-btn view-desc">查看</button></td>
</tr>`;
    } else {
      return `<tr class="data-row" data-want="" data-view="" data-price="">
  <td class="index-cell">${i + 1}</td>
  <td class="cover-cell">
    <div class="cover-box"><img src="${cover}" alt="cover" class="thumb"/></div>
  </td>
  <td class="link-cell"><a href="${p.url}" target="_blank">${p.url}</a></td>
</tr>`;
    }
  }).join('\n');

  const controls = withDetails ? `
<div class="toolbar">
  <div class="filters">
    <div class="filter-item">
      <label>想要数</label>
      <input type="number" id="minWant" placeholder="最小"> -
      <input type="number" id="maxWant" placeholder="最大">
    </div>
    <div class="filter-item">
      <label>浏览量</label>
      <input type="number" id="minView" placeholder="最小"> -
      <input type="number" id="maxView" placeholder="最大">
    </div>
    <div class="filter-item">
      <label>价格</label>
      <input type="number" id="minPrice" placeholder="最小"> -
      <input type="number" id="maxPrice" placeholder="最大">
    </div>
  </div>
  <div class="actions">
    <div class="sorts">
      <button id="sortWantAsc" class="btn">想要数↑</button>
      <button id="sortWantDesc" class="btn">想要数↓</button>
      <button id="sortViewAsc" class="btn">浏览量↑</button>
      <button id="sortViewDesc" class="btn">浏览量↓</button>
    </div>
    <div class="ops">
      <button id="applyFilter" class="btn primary">应用筛选</button>
      <button id="resetFilter" class="btn">重置</button>
    </div>
  </div>
</div>` : '';

  const style = `<style>
:root{--primary:#165DFF;--success:#36D399;--gray-50:#F8FAFC;--gray-100:#F2F3F5;--gray-200:#E5E6EB;--gray-600:#86909C;--gray-900:#1D2129;}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#fff;color:var(--gray-900);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,"Noto Sans",sans-serif;}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.header h1{font-size:18px;margin:0;color:#0E121B}
.header .meta{font-size:12px;color:var(--gray-600)}
.toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin:10px 0 14px;flex-wrap:wrap}
.filters{display:flex;gap:16px;flex-wrap:wrap}
.filter-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-600)}
.filter-item input{width:100px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;outline:none}
.filter-item input:focus{border-color:var(--primary)}
.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.actions .btn{padding:6px 10px;border:1px solid var(--gray-200);background:#fff;border-radius:6px;cursor:pointer}
.actions .btn.primary{background:var(--primary);color:#fff;border-color:var(--primary)}
.table-wrap{border:1px solid var(--gray-200);border-radius:8px;overflow:visible}
table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}
thead th{position:sticky;top:0;background:#F7F9FC;border-bottom:1px solid var(--gray-200);padding:10px 8px;font-weight:600;color:#0E121B;z-index:5;box-shadow:0 2px 0 rgba(0,0,0,.04)}
tbody td{padding:10px 8px;border-bottom:1px solid var(--gray-100);vertical-align:middle;color:#1D2129}
tbody tr:nth-child(odd){background:#fff}tbody tr:nth-child(even){background:#FBFCFF}
.index-cell{width:60px;text-align:center;color:var(--gray-600)}
.cover-cell{width:120px;text-align:center}
.cover-box{width:100px;height:100px;margin:0 auto;border:1px solid var(--gray-200);border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
.cover-box img.thumb{width:100px;height:100px;object-fit:contain;display:block;cursor:zoom-in}
.link-cell a{color:var(--primary);text-decoration:none;word-break:break-all}
.link-cell a:hover{text-decoration:underline}
.num{text-align:right;font-variant-numeric:tabular-nums}
.desc-cell{position:relative}
.desc.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.link-btn{background:none;border:0;color:var(--primary);cursor:pointer;font-size:12px;margin-top:6px;padding:0}
.footer{margin-top:12px;font-size:12px;color:var(--gray-600)}
/* Overlays */
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999}
.lightbox.hidden{display:none}
.lightbox img{max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.detail-panel{background:#fff;max-width:720px;width:90vw;max-height:85vh;border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:auto}
.detail-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.detail-title{font-weight:600}
.detail-content{white-space:pre-wrap;line-height:1.6;color:#1D2129}
</style>`;

  const table = `<div class="table-wrap"><table>
<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table></div>`;

  const overlay = `
<div id="lightbox" class="lightbox hidden" title="点击关闭"><img id="lightbox-img" alt="preview"></div>
<div id="detailbox" class="lightbox hidden" title="点击关闭">
  <div class="detail-panel">
    <div class="detail-header"><span class="detail-title">详细内容</span></div>
    <div id="detailContent" class="detail-content"></div>
  </div>
</div>`;

  const script = `<script>(function(){
  const $=s=>document.querySelector(s);const $$=s=>Array.from(document.querySelectorAll(s));
  const rows=$$('.data-row'); const tbody=document.querySelector('tbody');

  function num(v){return v==null||v===''?null:parseFloat(v);}

  function applyFilter(){
    const a=num($('#minWant')?.value),b=num($('#maxWant')?.value);
    const c=num($('#minView')?.value),d=num($('#maxView')?.value);
    const e=num($('#minPrice')?.value),f=num($('#maxPrice')?.value);
    rows.forEach(tr=>{
      const w=num(tr.dataset.want), v=num(tr.dataset.view), p=num(tr.dataset.price);
      let show=true;
      if(a!=null&&(w==null||w<a))show=false;
      if(b!=null&&(w!=null&&w>b))show=false;
      if(c!=null&&(v==null||v<c))show=false;
      if(d!=null&&(v!=null&&v>d))show=false;
      if(e!=null&&(p==null||p<e))show=false;
      if(f!=null&&(p!=null&&p>f))show=false;
      tr.style.display=show?'':'none';
    });
  }

  function sortRows(attr,dir){
    const list=rows.slice();
    list.sort((ra,rb)=>{
      const va=num(ra.dataset[attr]); const vb=num(rb.dataset[attr]);
      const a1 = (va==null? -Infinity : va); const b1=(vb==null? -Infinity : vb);
      return dir==='asc' ? (a1-b1) : (b1-a1);
    });
    list.forEach(tr=>tbody.appendChild(tr));
  }

  $('#applyFilter')?.addEventListener('click',applyFilter);
  $('#resetFilter')?.addEventListener('click',()=>{
    ['#minWant','#maxWant','#minView','#maxView','#minPrice','#maxPrice'].forEach(id=>{const el=$(id); if(el) el.value='';});
    rows.forEach(tr=>tr.style.display='');
  });

  $('#sortWantAsc')?.addEventListener('click',()=>sortRows('want','asc'));
  $('#sortWantDesc')?.addEventListener('click',()=>sortRows('want','desc'));
  $('#sortViewAsc')?.addEventListener('click',()=>sortRows('view','asc'));
  $('#sortViewDesc')?.addEventListener('click',()=>sortRows('view','desc'));

  // Image lightbox
  const lb=$('#lightbox'); const lbImg=$('#lightbox-img');
  document.addEventListener('click',(e)=>{
    const t=e.target;
    if(t&&t.classList&&t.classList.contains('thumb')){
      lbImg.src=t.src; lb.classList.remove('hidden');
    }else if(t===lb||t===lbImg){
      lb.classList.add('hidden'); lbImg.removeAttribute('src');
    }
  });

  // Desc detail modal
  const db=$('#detailbox'); const dc=$('#detailContent');
  document.addEventListener('click',(e)=>{
    const t=e.target;
    if(t && t.classList && t.classList.contains('view-desc')){
      const tr = t.closest('tr'); const d = tr?.querySelector('.desc')?.textContent || '';
      dc.textContent = d.trim(); db.classList.remove('hidden');
    }else if(t===db){
      db.classList.add('hidden'); dc.textContent='';
    }
  });
})();</script>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>闲鱼导出 - ${keyword}</title>${style}</head>
<body>
  <div class="header">
    <h1>闲鱼采集结果（${keyword}）</h1>
    <div class="meta">${new Date().toLocaleString()}</div>
  </div>
  ${withDetails ? controls : ''}
  ${table}
  <div class="footer">提示：点击图片放大；文案默认展示两行，点击“查看”弹窗展示完整内容；可使用上方条件过滤与排序。</div>
  ${overlay}
  ${script}
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); const ts = new Date().toISOString().replace(/[:.]/g,'-');
  a.href = url; a.download = `闲鱼-${keyword}-${ts}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/**
 * 导出为Excel（严格模式：内联样式/属性，确保图片不超出单元格）
 */
async function exportToExcelStrict(products, keyword, withDetails = true) {
  const headers = withDetails
    ? ['序号', '商品封面', '商品链接', '发布地', '想要数', '浏览量', '价格', '店铺名称', '产品文案']
    : ['序号', '商品封面', '商品链接'];

  // 将封面转为 dataURL（失败则保留原URL）
  const coverList = await Promise.all(products.map(p => p.coverImage ? toDataURL(p.coverImage) : ''));

  // 100px ≈ 75pt（Excel 更偏好 pt）
  const rowHeightPx = 100;
  const rowHeightPt = 75;
  const indexColWidth = 60; // 文本列宽保持 px 即可
  const coverColWidthPt = 75; // 封面列宽使用 pt 更稳定

  const colgroup = withDetails
    ? `<colgroup>
<col width="${indexColWidth}" />
<col style="width:${coverColWidthPt}pt" />
<col />
<col />
<col />
<col />
<col />
<col />
<col />
</colgroup>`
    : `<colgroup>
<col width="${indexColWidth}" />
<col style="width:${coverColWidthPt}pt" />
<col />
</colgroup>`;

  const rowsHtml = products.map((p, i) => {
    const cover = coverList[i] || '';
    if (withDetails) {
      return `<tr height="${rowHeightPx}" style="height:${rowHeightPt}pt; mso-height-source:exactly; mso-row-height:${rowHeightPt};">
<td align="center" style="width:${indexColWidth}px;padding:0;overflow:hidden;">${i + 1}</td>
<td align="center" valign="middle" style="width:${coverColWidthPt}pt;height:${rowHeightPt}pt;padding:0;overflow:hidden;">
  <img src="${cover}" width="100" height="100" style="display:block;margin:0 auto;border:0;width:${rowHeightPt}pt;height:${rowHeightPt}pt;max-width:${rowHeightPt}pt;max-height:${rowHeightPt}pt;" alt="cover"/>
</td>
<td style="word-break:break-all;padding:4px;"><a href="${p.url}" target="_blank">${p.url}</a></td>
<td style="padding:4px;">${cleanValue(p.location || '', '')}</td>
<td style="padding:4px;">${cleanValue(p.wantCount || '', 'wantCount')}</td>
<td style="padding:4px;">${cleanValue(p.viewCount || '', 'viewCount')}</td>
<td style="padding:4px;">${cleanValue(p.price || '', 'price')}</td>
<td style="padding:4px;">${cleanValue(p.shopName || '', '')}</td>
<td style="padding:4px;">${cleanValue(p.description || '', 'description')}</td>
</tr>`;
    } else {
      return `<tr height="${rowHeightPx}" style="height:${rowHeightPt}pt; mso-height-source:exactly; mso-row-height:${rowHeightPt};">
<td align="center" style="width:${indexColWidth}px;padding:0;overflow:hidden;">${i + 1}</td>
<td align="center" valign="middle" style="width:${coverColWidthPt}pt;height:${rowHeightPt}pt;padding:0;overflow:hidden;">
  <img src="${cover}" width="100" height="100" style="display:block;margin:0 auto;border:0;width:${rowHeightPt}pt;height:${rowHeightPt}pt;max-width:${rowHeightPt}pt;max-height:${rowHeightPt}pt;" alt="cover"/>
</td>
<td style="word-break:break-all;padding:4px;"><a href="${p.url}" target="_blank">${p.url}</a></td>
</tr>`;
    }
  }).join('\n');

  const table = `<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed;width:100%;mso-table-lspace:0pt;mso-table-rspace:0pt;mso-padding-alt:0pt 0pt 0pt 0pt;">
${colgroup}
<thead>
  <tr style="height:27pt;">
    ${headers.map(h => `<th style="border:1px solid #ccc;padding:4px;vertical-align:middle;background:#f7f7f7;">${h}</th>`).join('')}
  </tr>
</thead>
<tbody>
${rowsHtml}
</tbody>
</table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>闲鱼导出</title></head><body>${table}</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `闲鱼-${keyword}-${timestamp}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 导出为Excel（.xlsx 优先：将图片锚定到单元格；失败回退 .xls 严格模式）
 */
async function exportToExcel(products, keyword, withDetails = true) {
  try {
    if (!window.XlsxLite) throw new Error('XlsxLite not loaded');
    const headers = withDetails
      ? ['序号', '商品封面', '商品链接', '发布地', '想要数', '浏览量', '价格', '店铺名称', '产品文案']
      : ['序号', '商品封面', '商品链接'];

    const rows = [headers];
    const covers = await Promise.all(products.map(p => p.coverImage ? toDataURL(p.coverImage) : ''));

    products.forEach((p, i) => {
      const idx = String(i + 1);
      if (withDetails) {
        rows.push([
          idx, '', p.url || '',
          (p.location || '').toString(),
          (p.wantCount || '').toString(),
          (p.viewCount || '').toString(),
          (p.price || '').toString(),
          (p.shopName || '').toString(),
          (p.description || '').toString()
        ]);
      } else {
        rows.push([idx, '', p.url || '']);
      }
    });

    const images = [];
    for (let i = 0; i < products.length; i++) {
      const d = covers[i];
      if (!d) continue;
      images.push({ row: i + 2, col: 2, dataUrl: d, widthPx: 100, heightPx: 100 });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `闲鱼-${keyword}-${ts}.xlsx`;
    await window.XlsxLite.exportXlsxWithImages({ filename, rows, images });
  } catch (err) {
    console.warn('XLSX 导出不可用，回退 .xls:', err?.message || err);
    return exportToExcelStrict(products, keyword, withDetails);
  }
}

/**
 * 统一导出入口
 */
async function exportData(products, keyword, withDetails = true, exportType = 'csv') {
	switch (exportType) {
		case 'html':
			return exportToHTML(products, keyword, withDetails);
		case 'excel':
			return exportToExcel(products, keyword, withDetails);
		case 'csv':
		default:
			return exportToCSV(products, keyword, withDetails);
	}
}

/**
 * 并发执行异步任务
 * @param {Array} tasks - 任务数组
 * @param {number} concurrency - 并发数
 * @returns {Promise<Array>} 结果数组
 */
async function runConcurrently(tasks, concurrency) {
	const results = [];
	const running = new Set();

	async function runTask(task, index) {
		running.add(index);
		try {
			const result = await task();
			results[index] = result;
		} catch (error) {
			results[index] = error;
		}
		running.delete(index);
	}

	let index = 0;
	while (index < tasks.length || running.size > 0) {
		if (running.size < concurrency && index < tasks.length) {
			runTask(tasks[index], index);
			index++;
		} else {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	return results;
}

/**
 * 模拟人类行为的延迟函数
 * @returns {Promise<void>}
 */
async function humanDelay() {
	const base = 1000; // 基础延迟1秒
	const random = Math.random() * 2000; // 随机增加0-2秒
	await new Promise(resolve => setTimeout(resolve, base + random));
}

/**
 * 模拟人类滚动行为
 */
async function humanScroll() {
	const height = document.documentElement.scrollHeight;
	const steps = Math.floor(5 + Math.random() * 5); // 5-10步随机滚动

	for (let i = 0; i < steps; i++) {
		const nextPos = Math.floor((i + 1) * height / steps);
		window.scrollTo({
			top: nextPos,
			behavior: 'smooth'
		});
		await humanDelay();
	}
}

/**
 * 生成随机的鼠标移动
 */
async function simulateMouseMovement() {
	const x = Math.floor(Math.random() * window.innerWidth);
	const y = Math.floor(Math.random() * window.innerHeight);

	const event = new MouseEvent('mousemove', {
		view: window,
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y
	});

	document.dispatchEvent(event);
	await humanDelay();
}

/**
 * 模拟用户浏览行为
 */
async function simulateBrowsing() {
	await humanScroll();
	await simulateMouseMovement();

	// 随机点击一些安全的元素
	const safeElements = document.querySelectorAll('img, span, div');
	if (safeElements.length > 0) {
		const randomElement = safeElements[Math.floor(Math.random() * safeElements.length)];
		randomElement.scrollIntoView({
			behavior: 'smooth'
		});
		await humanDelay();
	}
}

/**
 * 采集商品链接和详情
 * @param {boolean} multiPage - 是否采集多页
 * @param {number} maxPages - 最大采集页数
 * @param {string} keyword - 搜索关键词
 * @param {boolean} collectDetail - 是否采集详情
 * @param {number} concurrentCount - 并发数
 * @returns {Promise<Array>} 商品链接数组
 */
async function collectProductLinks(multiPage = true, maxPages = 10, keyword = '', collectDetail = false,
	concurrentCount = 3, exportType = 'csv') {
	try {
		await __verifyNotice();
		if (collectProductLinks.isExecuting) {
			return [];
		}
		collectProductLinks.isExecuting = true;

		const uniqueLinks = new Set();
		let currentPage = 1;

		sendLog(`开始采集商品链接，计划采集 ${maxPages} 页`);
		sendProgress(0, maxPages, '正在采集商品链接...');

		do {
			await humanDelay();
			await simulateBrowsing(); // 使用更复杂的浏览行为

			sendLog(`正在采集第 ${currentPage}/${maxPages} 页`);
			sendProgress(currentPage, maxPages, `正在采集第 ${currentPage}/${maxPages} 页`);
			const links = await collectCurrentPageLinks();

			// 更长的随机暂停时间
			const pauseTime = 5000 + Math.random() * 8000;
			await new Promise(resolve => setTimeout(resolve, pauseTime));

			links.forEach(link => uniqueLinks.add(link));

			if (!multiPage || currentPage >= maxPages) break;

			const hasNext = await goToNextPage();
			if (!hasNext) break;

			currentPage++;
			await new Promise(resolve => setTimeout(resolve, 2000));
		} while (true);

		const linksArray = Array.from(uniqueLinks);
		sendLog(`商品链接采集完成，共 ${linksArray.length} 个商品`);
		sendProgress(linksArray.length, linksArray.length, `商品链接采集完成，共 ${linksArray.length} 个商品`);

		if (collectDetail && linksArray.length > 0) {
			sendLog(`开始采集商品详情，并发数：${concurrentCount}`);
			sendProgress(0, linksArray.length, `开始采集商品详情，并发数：${concurrentCount}`);

			let completed = 0;
			const tasks = linksArray.map((item, index) => async () => {
				sendLog(`采集商品详情 ${index + 1}/${linksArray.length}`);
				const detail = await fetchProductDetail(item.url);
				completed++;
				sendProgress(completed, linksArray.length, `采集商品详情 ${completed}/${linksArray.length}`);
				// 将列表页获取的封面图片传递到详情数据中
				return {
					...detail,
					coverImage: item.coverImage
				};
			});

			const products = await runConcurrently(tasks, concurrentCount);
			await exportData(products, keyword, true, exportType);
			sendLog('商品详情采集完成，已导出文件');
			return linksArray;
		} else {
			 const simpleProducts = linksArray.map(link => ({
			    url: link.url,
			    coverImage: link.coverImage
			  }));
			  await exportData(simpleProducts, keyword, false, exportType);
			sendLog('商品链接采集完成，已导出文件');
			return linksArray;
		}

	} catch (error) {
		sendLog(`采集失败: ${error.message}`);
		console.error('采集过程出错:', error);
		throw error; // 向上抛出错误，让消息监听器捕获
	} finally {
		collectProductLinks.isExecuting = false;
		// 将清理操作延迟执行，确保响应发送完成
		setTimeout(() => {
			chrome.runtime.sendMessage({
				action: 'cleanup'
			});
		}, 1000);
	}
}

async function fetchWithRetry(url, maxRetries = 3) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const detail = await fetchProductDetail(url);
			return detail;
		} catch (error) {
			if (i === maxRetries - 1) throw error;
			await humanDelay(); // 随机延迟后重试
		}
	}
}

console.log('闲鱼商品链接采集器已加载');