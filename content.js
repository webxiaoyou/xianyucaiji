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
					request.concurrentCount
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
	concurrentCount = 3) {
	try {
		if (collectProductLinks.isExecuting) {
			return [];
		}
		collectProductLinks.isExecuting = true;

		const uniqueLinks = new Set();
		let currentPage = 1;

		sendLog(`开始采集商品链接，计划采集 ${maxPages} 页`);

		do {
			await humanDelay();
			await simulateBrowsing(); // 使用更复杂的浏览行为

			sendLog(`正在采集第 ${currentPage}/${maxPages} 页`);
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

		if (collectDetail && linksArray.length > 0) {
			sendLog(`开始采集商品详情，并发数：${concurrentCount}`);

			const tasks = linksArray.map((item, index) => async () => {
				sendLog(`采集商品详情 ${index + 1}/${linksArray.length}`);
				const detail = await fetchProductDetail(item.url);
				// 将列表页获取的封面图片传递到详情数据中
				return {
					...detail,
					coverImage: item.coverImage
				};
			});

			const products = await runConcurrently(tasks, concurrentCount);
			exportToCSV(products, keyword, true);
			sendLog('商品详情采集完成，已导出CSV文件');
			return linksArray;
		} else {
			 const simpleProducts = linksArray.map(link => ({
			    url: link.url,
			    coverImage: link.coverImage
			  }));
			  exportToCSV(simpleProducts, keyword, false);
			sendLog('商品链接采集完成，已导出CSV文件');
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