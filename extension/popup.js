const API_URL = "http://localhost:5000/predict"; // change if your backend runs elsewhere

const scanBtn = document.getElementById("scanBtn");
const clearBtn = document.getElementById("clearBtn");
const resultsDiv = document.getElementById("results");
const status = document.getElementById("status");

clearBtn.addEventListener("click", () => {
    resultsDiv.innerHTML = "";
    status.textContent = "Cleared.";
});

function makeCard(url){
    const card = document.createElement('div');
    card.className = 'result-card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = 'thumbnail';
    // Set a temporary placeholder; we'll update when we can load the blob as object URL
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="file">${url}</div><div class="sub">Waiting for result</div>`;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const badge = document.createElement('div');
    badge.className = 'badge pending';
    badge.textContent = 'Pending';
    actions.appendChild(badge);

    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(actions);

    return {card, img, meta, badge, actions};
}

async function fetchAsBlob(url){
    try{
        const res = await fetch(url, {mode: 'cors'});
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        return blob;
    } catch(err){
        // Could be CORS or network error
        throw err;
    }
}

async function postToApi(blob){
    const fd = new FormData();
    fd.append('file', blob, 'media');
    const res = await fetch(API_URL, { method: 'POST', body: fd });
    if(!res.ok) throw new Error('Server ' + res.status);
    return await res.json();
}

async function handleUrl(url, index){
    const {card, img, meta, badge, actions} = makeCard(url);
    resultsDiv.appendChild(card);

    try{
        badge.textContent = 'Fetching';
        badge.className = 'badge pending';

        const blob = await fetchAsBlob(url);

        // show thumbnail when possible
        try{
            const objUrl = URL.createObjectURL(blob);
            img.src = objUrl;
        } catch(e){
            // ignore thumbnail errors
        }

        badge.textContent = 'Analyzing';

        const data = await postToApi(blob);

        if(data && data.label){
            badge.textContent = 'Done';
            badge.className = 'badge ok';
            meta.querySelector('.sub').textContent = `${data.label} — ${(data.confidence*100).toFixed(1)}%`;
        } else if(data && data.model_loaded === false){
            badge.textContent = 'No model';
            badge.className = 'badge err';
            meta.querySelector('.sub').textContent = 'Server running but model not loaded (dev mode).';
        } else {
            badge.textContent = 'No result';
            badge.className = 'badge err';
            meta.querySelector('.sub').textContent = 'No prediction available.';
        }

    } catch(err){
        console.error('Error for', url, err);
        badge.textContent = 'Error';
        badge.className = 'badge err';
        meta.querySelector('.sub').textContent = 'Could not fetch or analyze this file. This may be due to CORS or network restrictions.';

        // add retry and manual upload buttons
        const retry = document.createElement('button');
        retry.className = 'linklike';
        retry.textContent = 'Retry';
        retry.addEventListener('click', async () => {
            // remove retry button after click
            retry.disabled = true;
            meta.querySelector('.sub').textContent = 'Retrying...';
            badge.textContent = 'Retrying';
            try{
                const blob = await fetchAsBlob(url);
                const data = await postToApi(blob);
                if(data && data.label){
                    badge.textContent = 'Done';
                    badge.className = 'badge ok';
                    meta.querySelector('.sub').textContent = `${data.label} — ${(data.confidence*100).toFixed(1)}%`;
                    retry.remove();
                    uploadInput.remove();
                } else {
                    meta.querySelector('.sub').textContent = 'No prediction after retry.';
                    retry.disabled = false;
                }
            } catch(e){
                console.error('Retry failed', e);
                meta.querySelector('.sub').textContent = 'Retry failed (CORS or server error).';
                retry.disabled = false;
            }
        });

        const uploadInput = document.createElement('input');
        uploadInput.type = 'file';
        uploadInput.accept = 'image/*,video/*';
        uploadInput.addEventListener('change', async (ev) => {
            const f = ev.target.files[0];
            if(!f) return;
            meta.querySelector('.sub').textContent = 'Uploading local file...';
            badge.textContent = 'Uploading';
            try{
                const data = await postToApi(f);
                if(data && data.label){
                    badge.textContent = 'Done';
                    badge.className = 'badge ok';
                    meta.querySelector('.sub').textContent = `${data.label} — ${(data.confidence*100).toFixed(1)}%`;
                    retry.remove();
                    uploadInput.remove();
                } else {
                    meta.querySelector('.sub').textContent = 'No prediction for uploaded file.';
                }
            } catch(e){
                console.error('Upload failed', e);
                meta.querySelector('.sub').textContent = 'Upload failed.';
            }
        });

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'linklike';
        uploadBtn.textContent = 'Upload file';
        uploadBtn.addEventListener('click', () => uploadInput.click());

        actions.appendChild(retry);
        actions.appendChild(uploadBtn);
        actions.appendChild(uploadInput);
    }
}

scanBtn.addEventListener('click', async () => {
    resultsDiv.innerHTML = '';
    status.textContent = 'Scanning active tab...';

    try{
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const tab = tabs && tabs[0];
        if(!tab || !tab.id){
            status.textContent = 'No active tab found.';
            return;
        }

        const injection = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: () => {
                const media = Array.from(document.querySelectorAll('img, video'));
                const urls = media.map(m => m.src || m.currentSrc).filter(Boolean);
                return urls;
            }
        });

        const mediaUrls = injection && injection[0] && injection[0].result ? injection[0].result : [];
        if(mediaUrls.length === 0){
            status.textContent = 'No images or videos found on the page.';
            return;
        }

        status.textContent = `Found ${mediaUrls.length} items — processing...`;

        // start processing but keep UI responsive
        for(let i=0;i<mediaUrls.length;i++){
            // throttle small batches to avoid overwhelming the backend
            handleUrl(mediaUrls[i], i).catch(e => console.error(e));
            await new Promise(r => setTimeout(r, 120));
        }

        status.textContent = 'Processing started — results appear below.';
    } catch(e){
        console.error(e);
        status.textContent = 'Could not scan the page. Make sure the extension has permission to access the page.';
    }
});