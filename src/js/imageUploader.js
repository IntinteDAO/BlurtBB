import { Buffer } from 'https://cdn.skypack.dev/buffer';
import { CONFIG } from './config.js';
import * as auth from './auth.js';

// Helper to convert a binary string to a Uint8Array
function binaryStringToArray(str) {
    const len = str.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        arr[i] = str.charCodeAt(i);
    }
    return arr;
}

// Helper to concatenate Uint8Arrays (equivalent to Buffer.concat)
function concatArrays(arrays) {
    let totalLength = 0;
    for (const arr of arrays) {
        totalLength += arr.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

export function uploadImage(file, progressCallback) {
    return new Promise(async (resolve, reject) => {
        const user = auth.getCurrentUser();
        const key = auth.getPostingKey();

        if (!user || !key) {
            progressCallback({ error: 'Please login with your posting key first.' });
            return reject('Login required');
        }

        progressCallback({ message: 'Preparing image...' });

        // 1. Get image data as ArrayBuffer
        const reader = new FileReader();
        const arrayBuffer = await new Promise(resolve => {
            reader.onload = e => resolve(e.target.result);
            reader.readAsArrayBuffer(file);
        });
        const imageData = new Uint8Array(arrayBuffer);

        // 2. Create the signature
        const imageSigningChallenge = new TextEncoder().encode('ImageSigningChallenge');
        const dataToSign = concatArrays([imageSigningChallenge, imageData]);
        // Use browser's native crypto for hashing, and dblurt for signing
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataToSign);
        const privateKey = dblurt.PrivateKey.fromString(key);
        // Convert the native ArrayBuffer to a polyfilled Buffer object that the sign method expects.
        const nodeLikeBuffer = Buffer.from(hashBuffer);
        const signature = privateKey.sign(nodeLikeBuffer).toString();

        // 3. Prepare FormData
        const formData = new FormData();
        formData.append('file', file);

        // 4. Perform the upload
        const uploadUrl = `${CONFIG.IMAGE_UPLOAD_ENDPOINT}/${user}/${signature}`;
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);

        xhr.onload = () => {
            if (xhr.status === 200) {
                try {
                    const res = JSON.parse(xhr.responseText);
                    if (res.url) {
                        progressCallback({ url: res.url });
                        resolve(res.url);
                    } else {
                        progressCallback({ error: res.error || 'Unknown server error.' });
                        reject(res.error || 'Unknown server error.');
                    }
                } catch (e) {
                    progressCallback({ error: 'Invalid server response.' });
                    reject('Invalid server response');
                }
            } else {
                progressCallback({ error: `Upload failed: ${xhr.statusText}` });
                reject(`Upload failed: ${xhr.statusText}`);
            }
        };

        xhr.onerror = () => {
            progressCallback({ error: 'Network error during upload.' });
            reject('Network error');
        };

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                progressCallback({ message: `Uploading ${percent}%` });
            }
        };

        xhr.send(formData);
    });
}