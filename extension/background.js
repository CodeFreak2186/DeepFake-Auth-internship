// Background service worker: keep lightweight and avoid noisy logs.
chrome.runtime.onMessage.addListener((message, sender) => {
	if(message && message.type === 'MEDIA_URLS' && Array.isArray(message.urls)){
		const count = message.urls.length;
		// Log a compact summary for debugging (do not print the full URL list)
		console.info(`MEDIA_URLS received from ${sender.tab && sender.tab.url ? sender.tab.url : 'unknown'} — ${count} items`);
	}
});