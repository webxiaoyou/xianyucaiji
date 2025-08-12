document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startCollect');
  const keywordInput = document.getElementById('keyword');
  const pageCountInput = document.getElementById('pageCount');
  const collectDetailCheckbox = document.getElementById('collectDetail');
  const progressContainer = document.getElementById('progress');
  const progressText = document.querySelector('.progress-text');
  const progressStatus = document.querySelector('.progress-status');
  const logOutput = document.getElementById('logOutput');
  const clearLogButton = document.getElementById('clearLog');

  function waitForPageLoad(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  async function injectAndWaitForContentScript(tabId) {
    try {
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        return;
      } catch (error) {
        console.log('需要注入 content script');
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      console.error('注入脚本失败:', error);
      throw error;
    }
  }

  function updateProgress(current, total, status = '') {
    progressContainer.style.display = 'block';
    progressStatus.textContent = `${current}/${total}`;
    if (status) {
      progressText.textContent = status;
    }
  }

  function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    logOutput.value += `[${timestamp}] ${message}\n`;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  clearLogButton.addEventListener('click', () => {
    logOutput.value = '';
  });

  startButton.addEventListener('click', async () => {
    try {
      const keyword = keywordInput.value.trim();
      if (!keyword) {
        log('请输入搜索关键词');
        return;
      }

      log(`开始采集关键词: ${keyword}`);

      const pageCount = parseInt(pageCountInput.value) || 10;
      if (pageCount < 1 || pageCount > 100) {
        log('页数必须在1-100之间');
        return;
      }

      const collectDetail = collectDetailCheckbox.checked;

      startButton.textContent = '采集中...';
      startButton.disabled = true;
      progressContainer.style.display = 'block';
      progressText.textContent = '正在采集商品链接...';
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.includes('goofish.com') && !tab.url.includes('idle.fish')) {
        const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;
        await chrome.tabs.update(tab.id, { url: searchUrl });
        await waitForPageLoad(tab.id);
      }

      await injectAndWaitForContentScript(tab.id);

      if (tab.url.includes('goofish.com') || tab.url.includes('idle.fish')) {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'search',
          keyword: keyword
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const concurrentCount = parseInt(document.getElementById('concurrentCount').value) || 3;

      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'collect',
        pageCount: pageCount,
        keyword: keyword,
        collectDetail: collectDetail,
        concurrentCount: concurrentCount,
        onProgress: (current, total, status) => updateProgress(current, total, status)
      });
      
      if (response?.links?.length > 0) {
        if (collectDetail) {
          log('详细数据已导出到CSV文件');
        }
        startButton.textContent = `成功采集 ${response.links.length} 个商品`;
        log(`采集完成，共 ${response.links.length} 个商品`);
      } else {
        log('未找到商品链接，请确保在闲鱼搜索结果页面');
      }
    } catch (error) {
      log(`采集失败: ${error.message}`);
    } finally {
      startButton.disabled = false;
      setTimeout(() => {
        startButton.textContent = '开始采集';
        progressContainer.style.display = 'none';
      }, 2000);
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'log') {
      log(request.message);
    }
  });
}); 