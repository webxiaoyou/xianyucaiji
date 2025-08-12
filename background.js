let activeTabs = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'cleanup') {
    cleanupAll();
  }
  if (request.action === 'fetchDetail') {
    let responseReceived = false;
    let timeoutId = null;

    const cleanup = (tab) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (tab && tab.id) {
        activeTabs.delete(tab.id);
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    };

    const waitForFullLoad = async (tabId) => {
      // 等待页面基本加载完成
      await new Promise((resolve, reject) => {
        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => reject(new Error('页面加载超时')), 15000);
      });

      // 等待关键元素出现
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 20;
            const checkElements = () => {
              const price = document.querySelector('[class*="price"]');
              const userInfo = document.querySelector('[class*="user-info"]');
              const mainContent = document.querySelector('#content');
              const description = document.querySelector('[class*="notLoginContainer"] [class*="main"]');
              
              if (price && userInfo && mainContent && description) {
                resolve();
              } else {
                attempts++;
                if (attempts >= maxAttempts) {
                  reject(new Error('关键元素加载超时'));
                } else {
                  setTimeout(checkElements, 500);
                }
              }
            };
            checkElements();
          });
        }
      });

      // 额外等待以确保动态内容加载完成
      await new Promise(resolve => setTimeout(resolve, 2000));
    };

    async function createTab(url) {
      // 创建新标签页时添加随机延迟
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      return chrome.tabs.create({ 
        url: url, 
        active: false 
      });
    }

    (async () => {
      let tab = null;
      try {
        // 设置30秒总超时
        timeoutId = setTimeout(() => {
          if (!responseReceived) {
            cleanup(tab);
            responseReceived = true;
            sendResponse({ success: false, error: '获取详情超时' });
          }
        }, 30000);

        // 创建新标签页
        tab = await createTab(request.url);
        activeTabs.add(tab.id);
        
        // 等待页面完全加载
        await waitForFullLoad(tab.id);

        // 执行数据采集脚本
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selectors = {
              location: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-user-container--fbTUeNre > a > div > div.item-user-info-text--tKOlwunK > div.item-user-info-intro--ZN1A0_8Y > div:nth-child(1)',
                backup: [
                  '[class*="item-user-info-intro"] div:first-child',
                  '[class*="user-info"] [class*="location"]'
                ]
              },
			   coverImage: {
			      primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-pic-container--G6nYF3fX > div > img',
			      backup: [
			        '[class*="item-pic-container"] img',
			        '[class*="main-img"]',
			        'img[src*="item_pic"]'
			      ]
			    },
              wantCount: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div.tips--bJdC_yBS > div.want--ecByv3Sr > div:nth-child(1)',
                backup: [
                  '[class*="tips"] [class*="want"] > div:first-child',
                  'div[class*="want"] > div:first-child'
                ]
              },
              viewCount: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div.tips--bJdC_yBS > div.want--ecByv3Sr > div:nth-child(3)',
                backup: [
                  '[class*="tips"] [class*="want"] > div:nth-child(3)',
                  'div[class*="want"] > div:nth-child(3)'
                ]
              },
              price: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div:nth-child(1) > div > div.price--OEWLbcxC.windows--oJroL99y',
                backup: [
                  '[class*="price"]',
                  'div[class*="price"]'
                ]
              },
              shopName: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-user-container--fbTUeNre > a > div > div.item-user-info-text--tKOlwunK > div.item-user-info-main--iHQtqVC2 > div.item-user-info-nick--rtpDhkmQ',
                backup: [
                  '[class*="user-info-nick"]',
                  '[class*="nick"]'
                ]
              },
              description: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div.notLoginContainer--hQCDYhxp > div.main--Nu33bWl6.open--gEYf_BQc > div',
                backup: [
                  '[class*="notLoginContainer"] [class*="main"] > div',
                  '[class*="main"] > div'
                ]
              }
            };

            function findElement(selectorConfig) {
              let element = document.querySelector(selectorConfig.primary);
              if (element) {
                console.log('使用主选择器成功');
                return element;
              }

              for (const backupSelector of selectorConfig.backup) {
                element = document.querySelector(backupSelector);
                if (element) {
                  console.log('使用备用选择器成功:', backupSelector);
                  return element;
                }
              }

              console.log('所有选择器都失败');
              return null;
            }

            const details = {};
            for (const [key, selectorConfig] of Object.entries(selectors)) {
              const element = findElement(selectorConfig);
              details[key] = element ? element.textContent.trim() : '';
              console.log(`${key}:`, details[key] || '未找到');
            }

            return details;
          }
        });

        if (!responseReceived) {
          responseReceived = true;
          sendResponse({ success: true, details: result.result });
        }

        cleanup(tab);
      } catch (error) {
        console.error('获取详情失败:', error);
        if (!responseReceived) {
          responseReceived = true;
          sendResponse({ success: false, error: error.message });
        }
        cleanup(tab);
      }
    })();

    return true; // 保持消息通道开启
  }
});

function cleanupAll() {
  for (const tabId of activeTabs) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  activeTabs.clear();
}

chrome.runtime.onSuspend.addListener(cleanupAll); 