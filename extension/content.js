// Collect all image and video srcs on the page and either return them (when invoked via
// chrome.scripting.executeScript with a function) or post them via runtime message
// when executed as a content script file.

(function(){
    const media = Array.from(document.querySelectorAll('img, video'));
    const urls = media.map(m => m.src || m.currentSrc).filter(Boolean);

    // If the script was injected as a file, chrome.scripting.executeScript won't
    // capture a return value. In that case, send a message to the extension runtime.
    if(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage){
        try{
            chrome.runtime.sendMessage({type: 'MEDIA_URLS', urls});
        } catch(e) {
            // ignore if messaging is not available in the context
        }
    }

    // Also return the urls so the function-injection path can receive them directly.
    return urls;
})();
