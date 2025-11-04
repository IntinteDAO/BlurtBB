import { CONFIG } from './config.js';
import * as blockchain from './blockchain.js';
import * as auth from './auth.js';
import * as blacklist from './blacklist.js';
import * as beneficiaries from './beneficiaries.js';
import * as settings from './settings.js';
import { uploadImage } from './imageUploader.js';

// Get DOM elements once
const appContainer = document.getElementById('app');
const authContainer = document.getElementById('auth-container');
const loginModalElement = document.getElementById('loginModal');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let easyMDEInstance = null;
let postViewPoller = null;
let currentRenderVotes = null;

const loaderOverlay = document.getElementById('loader-overlay');
function showLoader() { loaderOverlay.classList.remove('d-none'); }
function hideLoader() { loaderOverlay.classList.add('d-none'); }

function updateAuthUI() {
    const user = auth.getCurrentUser();
    if (user) {
        const avatarUrl = blockchain.getAvatarUrl(user);
        authContainer.innerHTML = `
            <div class="dropdown text-end">
                <a href="#" class="d-block link-dark text-decoration-none dropdown-toggle" id="dropdownUser1" data-bs-toggle="dropdown" aria-expanded="false">
                    <img src="${avatarUrl}" alt="${user}" width="32" height="32" class="rounded-circle">
                </a>
                <ul class="dropdown-menu text-small" aria-labelledby="dropdownUser1">
                    <li><a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#newPostModal">New Post...</a></li>
                    <li><a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#configModal">Configuration</a></li>
                    <li><a class="dropdown-item" href="https://blurtwallet.com/@${user}" target="_blank">Wallet</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item" id="logout-button">Logout</a></li>
                </ul>
            </div>`;
        document.getElementById('logout-button').addEventListener('click', (e) => {
            e.preventDefault();
            auth.logout();
            updateAuthUI();
            handleRouteChange();
        });
        const dropdownElement = document.getElementById('dropdownUser1');
        if (dropdownElement) {
            setTimeout(() => {
                if (window.bootstrap && window.bootstrap.Dropdown) {
                    new window.bootstrap.Dropdown(dropdownElement);
                }
            }, 100);
        }
    } else {
        authContainer.innerHTML = `<button type="button" class="btn btn-outline-primary me-2" data-bs-toggle="modal" data-bs-target="#loginModal">Login</button>`;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    loginError.classList.add('d-none');
    const username = loginForm.username.value.trim();
    const postingKey = loginForm.postingKey.value.trim();
    const keepLoggedIn = loginForm.keepLoggedIn.checked;

    if (!username || !postingKey) {
        loginError.textContent = 'Username and posting key are required.';
        loginError.classList.remove('d-none');
        return;
    }

    try {
        const success = await auth.login(username, postingKey, keepLoggedIn);
        if (success) {
            const modal = bootstrap.Modal.getInstance(loginModalElement);
            modal.hide();
            updateAuthUI();
            handleRouteChange();
            loginForm.reset();
        }
    } catch (error) {
        loginError.textContent = error.message;
        loginError.classList.remove('d-none');
    }
}

async function handlePostSubmit(e, draftKey) {
    e.preventDefault();
    const title = document.getElementById('topic-title').value;
    const body = easyMDEInstance.value();
    const errorDiv = document.getElementById('post-error');
    const categoryId = new URLSearchParams(window.location.search).get('new_topic_in');

    if (!title.trim() || !body.trim()) {
        errorDiv.textContent = "Title and content cannot be empty.";
        errorDiv.classList.remove('d-none');
        return;
    }

    e.target.querySelector('button[type="submit"]').disabled = true;
    errorDiv.classList.add('d-none');

    try {
        const author = auth.getCurrentUser();
        const key = auth.getPostingKey();
        const result = await blockchain.broadcastPost(author, key, categoryId, title, body);

        if (draftKey) {
            localStorage.removeItem(draftKey);
            localStorage.removeItem(`${draftKey}-title`);
        }

        appContainer.innerHTML = `<div class="text-center mt-5"><h4>Post submitted successfully!</h4><p>Waiting for it to be confirmed on the blockchain...</p><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>`;
        pollForPost(author, result.finalPermlink);
    } catch (error) {
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.classList.remove('d-none');
        e.target.querySelector('button[type="submit"]').disabled = false;
    }
}

async function handleReplySubmit(e, parentAuthor, parentPermlink) {
    e.preventDefault();
    const body = easyMDEInstance.value();
    const errorDiv = document.getElementById('reply-error');

    if (!body.trim()) {
        errorDiv.textContent = "Reply content cannot be empty.";
        errorDiv.classList.remove('d-none');
        return;
    }

    e.target.querySelector('button[type="submit"]').disabled = true;
    errorDiv.classList.add('d-none');

    try {
        const author = auth.getCurrentUser();
        const key = auth.getPostingKey();
        const { replies } = await blockchain.getPostAndDirectReplies(parentAuthor, parentPermlink);
        const originalReplyCount = replies.length;

        await blockchain.broadcastReply(author, key, parentAuthor, parentPermlink, body);

        if (easyMDEInstance) {
            easyMDEInstance.toTextArea();
            easyMDEInstance = null;
        }

        e.target.closest('#reply-form').innerHTML = '<p class="text-success">Reply submitted! Waiting for confirmation...</p>';

        let attempts = 0;
        const maxAttempts = 15;
        const poller = setInterval(async () => {
            attempts++;
            const data = await blockchain.getPostAndDirectReplies(parentAuthor, parentPermlink);
            if (data && data.replies.length > originalReplyCount) {
                clearInterval(poller);
                handleRouteChange();
            } else if (attempts >= maxAttempts) {
                clearInterval(poller);
                Toastify({ text: "Reply was submitted, but it's taking a long time to appear.", duration: 5000, backgroundColor: "orange" }).showToast();
            }
        }, 2000);

    } catch (error) {
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.classList.remove('d-none');
        e.target.querySelector('button[type="submit"]').disabled = false;
    }
}

async function handleEditSubmit(e, originalPost, draftKey) {
    e.preventDefault();
    const titleInput = document.getElementById('edit-title');
    const title = titleInput ? titleInput.value : originalPost.title;
    const body = easyMDEInstance.value();
    const errorDiv = document.getElementById('edit-error');

    if (!body.trim() || (originalPost.title && !title.trim())) {
        errorDiv.textContent = "Title and content cannot be empty.";
        errorDiv.classList.remove('d-none');
        return;
    }

    e.target.querySelector('button[type="submit"]').disabled = true;

    try {
        const key = auth.getPostingKey();
        const originalLastUpdate = originalPost.last_update;

        await blockchain.broadcastEdit(originalPost.author, key, originalPost, title, body);

        if (draftKey) {
            localStorage.removeItem(draftKey);
            localStorage.removeItem(`${draftKey}-title`);
        }

        appContainer.innerHTML = `<div class="text-center mt-5"><h4>Changes submitted!</h4><p>Waiting for confirmation...</p><div class="spinner-border"></div></div>`;
        pollForEdit(originalPost.author, originalPost.permlink, originalLastUpdate);

    } catch (error) {
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.classList.remove('d-none');
        e.target.querySelector('button[type="submit"]').disabled = false;
    }
}

async function handleVoteClick(btn) {
    const { author, permlink } = btn.dataset;
    const voter = auth.getCurrentUser();
    const key = auth.getPostingKey();
    if (!voter || !key) {
        Toastify({ text: "You must be logged in to vote.", backgroundColor: "orange" }).showToast();
        return;
    }
    const isUnvoting = btn.classList.contains('btn-success');
    const weight = isUnvoting ? 0 : 10000;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
    try {
        await blockchain.broadcastVote(voter, key, author, permlink, weight);
        Toastify({ text: "Vote submitted successfully!", backgroundColor: "green" }).showToast();
        if (currentRenderVotes) await currentRenderVotes();
    } catch (error) {
        console.error("Vote failed:", error);
        Toastify({ text: `Vote failed: ${error.message}`, backgroundColor: "red" }).showToast();
        if (currentRenderVotes) await currentRenderVotes();
    }
}

async function handleDeleteClick(e, author, permlink) {
    e.preventDefault();
    Toastify({
        text: "Are you sure you want to delete this? This action cannot be undone.",
        duration: 10000, close: true, gravity: "top", position: "center",
        backgroundColor: "linear-gradient(to right, #ff6e40, #ffc107)",
        stopOnFocus: true,
        onClick: async function() {
            try {
                const key = auth.getPostingKey();
                await blockchain.broadcastDelete(author, key, permlink);
                e.target.closest('.list-group-item, .card').innerHTML = '<p class="text-muted">[This content has been deleted]</p>';
                Toastify({ text: "Content deleted.", backgroundColor: "green" }).showToast();
            } catch (error) {
                console.error("Delete failed:", error);
                Toastify({ text: `Failed to delete: ${error.message}`, backgroundColor: "red" }).showToast();
            }
        }
    }).showToast();
}

function getRoleBadge(username) {
    if (CONFIG.admins.includes(username)) return `<span class="badge bg-danger ms-2">Admin</span>`;
    if (CONFIG.moderators.includes(username)) return `<span class="badge bg-success ms-2">Moderator</span>`;
    return '';
}

function getAllCategories() {
    return CONFIG.category_groups.flatMap(group => group.categories);
}

function pollForPost(author, permlink) {
    let attempts = 0;
    const maxAttempts = 15, interval = 2000;
    const poller = setInterval(async () => {
        attempts++;
        const data = await blockchain.getPostAndDirectReplies(author, permlink);
        if (data && data.post && data.post.author) {
            clearInterval(poller);
            history.pushState({}, '', `?post=@${author}/${permlink}`);
            handleRouteChange();
        } else if (attempts >= maxAttempts) {
            clearInterval(poller);
            Toastify({ text: "Post was submitted, but it's taking a long time to appear. You will be redirected.", duration: 5000 }).showToast();
            history.pushState({}, '', '/');
            handleRouteChange();
        }
    }, interval);
}

function pollForEdit(author, permlink, originalLastUpdate) {
    let attempts = 0;
    const maxAttempts = 15, interval = 2000;
    const poller = setInterval(async () => {
        attempts++;
        const data = await blockchain.getPostAndDirectReplies(author, permlink);
        if (data && data.post && data.post.last_update !== originalLastUpdate) {
            clearInterval(poller);
            Toastify({ text: "Edit confirmed!", backgroundColor: "green" }).showToast();
            history.back();
        } else if (attempts >= maxAttempts) {
            clearInterval(poller);
            Toastify({ text: "Edit was submitted, but it's taking a long time to confirm.", duration: 5000, backgroundColor: "orange" }).showToast();
        }
    }, interval);
}

function renderMainView() {
    document.title = CONFIG.forum_title;
    let html = `<h1>${CONFIG.forum_title}</h1>`;
    CONFIG.category_groups.forEach(group => {
        html += `<div class="card mb-4"><div class="card-header"><h4>${group.group_title}</h4></div><div class="list-group list-group-flush">`;
        group.categories.forEach(cat => {
            html += `<a href="?category=${cat.id}" class="list-group-item list-group-item-action"><div class="d-flex w-100 justify-content-between"><h5 class="mb-1">${cat.title}</h5></div><p class="mb-1">${cat.description}</p></a>`;
        });
        html += `</div></div>`;
    });
    appContainer.innerHTML = html;
}

async function renderCategoryView(categoryId) {
    showLoader();
    const params = new URLSearchParams(window.location.search);
    const startAuthor = params.get('start_author');
    const startPermlink = params.get('start_permlink');

    const category = getAllCategories().find(c => c.id === categoryId);
    if (!category) { renderNotFound(); return; }

    document.title = `${category.title} - ${CONFIG.forum_title}`;
    const user = auth.getCurrentUser();
    let headerHtml = `<div class="d-flex justify-content-between align-items-center mb-3"><div><h2>${category.title}</h2><p class="mb-0">${category.description}</p></div>${user ? `<a href="?new_topic_in=${categoryId}" class="btn btn-primary">New Topic</a>` : ''}</div>`;

    let topics = await blockchain.getTopics(categoryId, startAuthor, startPermlink);
    topics = topics.filter(topic => !blacklist.isBlacklisted(topic.author, topic.permlink));

    let topicsHtml = '<ul class="list-group">';
    if (topics.length > 0) {
        let topicData = await Promise.all(topics.map(async topic => {
            const cacheKey = `last-reply-cache-${topic.author}-${topic.permlink}`;
            try {
                const cachedData = JSON.parse(localStorage.getItem(cacheKey));
                if (cachedData && cachedData.childrenCount === topic.children) {
                    return { ...topic, lastPostAuthor: cachedData.lastPostAuthor, lastPostDate: cachedData.lastPostDate };
                }
            } catch (e) {}
            const lastReply = await blockchain.getLastReply(topic.author, topic.permlink);
            const newData = {
                childrenCount: topic.children,
                lastPostAuthor: lastReply ? lastReply.author : topic.author,
                lastPostDate: lastReply ? lastReply.created : topic.created
            };
            localStorage.setItem(cacheKey, JSON.stringify(newData));
            return { ...topic, ...newData };
        }));

        topicData.sort((a, b) => new Date(b.lastPostDate) - new Date(a.lastPostDate));

        topicData.forEach(topic => {
            // Notification Logic
            const notificationKey = `notification-cache-${topic.author}-${topic.permlink}`;
            const storedReplies = localStorage.getItem(notificationKey);
            const currentReplies = topic.children;
            let iconClass = 'fa-bell-slash text-muted'; // Default: read
            let isNew = false;

            if (storedReplies === null) {
                localStorage.setItem(notificationKey, currentReplies);
            } else {
                if (currentReplies > parseInt(storedReplies, 10)) {
                    iconClass = 'fa-bell text-primary'; // New replies
                    isNew = true;
                }
            }

            let notificationBellHtml = '';
            if (isNew) {
                notificationBellHtml = `
                    <div class="text-center me-4 d-flex align-items-center">
                        <a href="#" class="notification-bell" title="Mark as read" data-author="${topic.author}" data-permlink="${topic.permlink}" data-current-replies="${currentReplies}">
                            <i class="fa-regular ${iconClass} fs-2 fa-fw"></i>
                        </a>
                    </div>
                `;
            } else {
                notificationBellHtml = `
                    <div class="text-center me-4 d-flex align-items-center" title="No new replies">
                        <i class="fa-regular ${iconClass} fs-2 fa-fw"></i>
                    </div>
                `;
            }

            const lastPostAvatarUrl = blockchain.getAvatarUrl(topic.lastPostAuthor);
            const lastPostHtml = `<div class="d-flex align-items-center" style="min-width: 180px;"><a href="?profile=${topic.lastPostAuthor}" class="me-2"><img src="${lastPostAvatarUrl}" class="rounded-circle" width="32" height="32" alt="${topic.lastPostAuthor}"></a><div><a href="?profile=${topic.lastPostAuthor}" class="text-break">@${topic.lastPostAuthor}</a><br><small class="text-muted"><a href="?post=@${topic.author}/${topic.permlink}" class="text-muted"><time datetime="${topic.lastPostDate}">${new Date(topic.lastPostDate).toLocaleString()}</time></a></small></div></div>`;
            
            topicsHtml += `<li class="list-group-item"><div class="d-flex w-100 align-items-center">${notificationBellHtml}<div class="flex-grow-1"><h5 class="mb-1"><a href="?post=@${topic.author}/${topic.permlink}">${topic.title}</a></h5><small class="text-muted">By <a href="?profile=${topic.author}">@${topic.author}</a>, ${new Date(topic.created).toLocaleString()}</small></div><div class="text-center mx-4" style="min-width: 80px;"><span class="d-block fs-5">${topic.children}</span><small class="text-muted">replies</small></div>${lastPostHtml}</div></li>`;
        });
    } else {
        topicsHtml += '<li class="list-group-item">No topics found.</li>';
    }
    topicsHtml += '</ul>';

    let paginationHtml = '';
    if (topics.length === CONFIG.topics_per_page) {
        const lastTopic = topics[topics.length - 1];
        paginationHtml = `<div class="d-flex justify-content-end mt-3"><a href="?category=${categoryId}&start_author=${lastTopic.author}&start_permlink=${lastTopic.permlink}" class="btn btn-outline-primary">Next Page &rarr;</a></div>`;
    }

    appContainer.innerHTML = headerHtml + topicsHtml + paginationHtml;
    hideLoader();
}

function renderMarkdown(text) {
    if (!text) return '';
    // EasyMDE requires the textarea to be in the DOM.
    const tempTextArea = document.createElement('textarea');
    tempTextArea.style.display = 'none'; // Make it invisible
    document.body.appendChild(tempTextArea);

    const tempMDE = new EasyMDE({ element: tempTextArea, autoDownloadFontAwesome: false });
    const html = tempMDE.markdown(text);
    
    // Clean up the instance and the DOM element
    tempMDE.toTextArea();
    document.body.removeChild(tempTextArea);

    return html;
}

async function renderPostView(author, permlink) {
    showLoader();
    if (blacklist.isBlacklisted(author, permlink)) {
        renderError("This content is unavailable because the author or post is blacklisted.");
        return;
    }
    const post = await blockchain.getPostWithReplies(author, permlink);
    if (!post || !post.author) { renderNotFound(); return; }

    // Mark topic as read by updating the notification cache
    const notificationKey = `notification-cache-${post.author}-${post.permlink}`;
    localStorage.setItem(notificationKey, post.children);

    document.title = `${post.title} - ${CONFIG.forum_title}`;
    const user = auth.getCurrentUser();
    const postAuthorAvatarUrl = blockchain.getAvatarUrl(post.author);

    const allReplies = [];
    const contentMap = { [`@${post.author}/${post.permlink}`]: post };
    function flattenAndMap(replies) {
        if (!replies) return;
        replies.forEach(reply => {
            if (blacklist.isBlacklisted(reply.author, reply.permlink)) return;
            allReplies.push(reply);
            contentMap[`@${reply.author}/${reply.permlink}`] = reply;
            flattenAndMap(reply.replies);
        });
    }
    flattenAndMap(post.replies);
    allReplies.sort((a, b) => new Date(a.created) - new Date(b.created));

    let html = `
        <div class="card mb-3">
            <div class="card-body">
                <div class="row">
                    <div class="col-md-3 text-center border-end">
                        <a href="?profile=${post.author}"><img src="${postAuthorAvatarUrl}" alt="${post.author}" class="rounded-circle mb-2" width="60" height="60"><h5 class="mb-0">@${post.author}</h5></a>
                        ${getRoleBadge(post.author)}
                        <small class="text-muted d-block mt-2">Posted: ${new Date(post.created).toLocaleString()}</small>
                    </div>
                    <div class="col-md-9">
                        <h1 class="card-title">${post.title}</h1>
                        <div class="card-text fs-5 mb-3 markdown-content">${renderMarkdown(post.body)}</div>
                        <div class="d-flex align-items-center justify-content-between mt-3">
                            <div class="d-flex align-items-center vote-section" data-author="${post.author}" data-permlink="${post.permlink}"></div>
                            <div>
                                ${user ? `<button class="btn btn-sm btn-outline-primary me-2 reply-to-btn" data-author="${post.author}" data-permlink="${post.permlink}">Reply</button>` : ''}
                                ${user === post.author ? `<a href="?edit=@${post.author}/${post.permlink}" class="btn btn-sm btn-outline-secondary me-2">Edit</a><button id="delete-post-btn" class="btn btn-sm btn-outline-danger">Delete</button>` : ''}
                            </div>
                        </div>
                        <div class="reply-form-container mt-3"></div>
                    </div>
                </div>
            </div>
        </div>
        <h3>Replies</h3>`;

    if (allReplies.length > 0) {
        html += '<div class="list-group">';
        allReplies.forEach(reply => {
            const replyAvatarUrl = blockchain.getAvatarUrl(reply.author);
            let quoteHtml = '';
            const parentKey = `@${reply.parent_author}/${reply.parent_permlink}`;
                        const parent = contentMap[parentKey];
                        // Only show a quote if the reply is to another comment, not the main post.
                        if (parent && (reply.parent_author !== post.author || reply.parent_permlink !== post.permlink)) {
                            const parentBody = parent.body.substring(0, 100) + (parent.body.length > 100 ? '...' : '');
                            quoteHtml = `<blockquote class="blockquote-footer bg-light p-2 rounded-top"><a href="?post=@${reply.parent_author}/${reply.parent_permlink}">@${reply.parent_author}</a> wrote:<p class="mb-0 fst-italic">${parentBody}</p></blockquote>`;
                        }
            html += `
                <div id="@${reply.author}/${reply.permlink}" class="list-group-item mt-3">
                    <div class="row">
                        <div class="col-md-3 text-center border-end">
                            <a href="?profile=${reply.author}"><img src="${replyAvatarUrl}" alt="${reply.author}" class="rounded-circle mb-2" width="40" height="40"><h6 class="mb-0">@${reply.author}</h6></a>
                            ${getRoleBadge(reply.author)}
                            <small class="text-muted d-block mt-2">${new Date(reply.created).toLocaleString()}</small>
                        </div>
                        <div class="col-md-9">
                            ${quoteHtml}
                            <div class="mb-2 markdown-content">${renderMarkdown(reply.body)}</div>
                            <div class="d-flex align-items-center justify-content-between mt-2">
                                <div class="d-flex align-items-center vote-section" data-author="${reply.author}" data-permlink="${reply.permlink}"></div>
                                <div>
                                    ${user ? `<button class="btn btn-sm btn-link text-secondary reply-to-btn" data-author="${reply.author}" data-permlink="${reply.permlink}">Reply</button>` : ''}
                                    ${user === reply.author ? `<a href="?edit=@${reply.author}/${reply.permlink}" class="btn btn-sm btn-link text-secondary">Edit</a><button class="btn btn-sm btn-link text-danger delete-reply-btn" data-permlink="${reply.permlink}">Delete</button>` : ''}
                                </div>
                            </div>
                            <div class="reply-form-container mt-3"></div>
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
    } else {
        html += '<p>No replies yet.</p>';
    }

    appContainer.innerHTML = html;

    // Wrap iframes for responsiveness after content is rendered
    appContainer.querySelectorAll('.markdown-content iframe').forEach(iframe => {
        const wrapper = document.createElement('div');
        wrapper.className = 'responsive-iframe-container';
        iframe.parentNode.insertBefore(wrapper, iframe);
        wrapper.appendChild(iframe);
    });

    if (user) {
        const deletePostBtn = document.getElementById('delete-post-btn');
        if (deletePostBtn) deletePostBtn.addEventListener('click', (e) => handleDeleteClick(e, post.author, post.permlink));
        document.querySelectorAll('.delete-reply-btn').forEach(btn => {
            btn.addEventListener('click', (e) => handleDeleteClick(e, user, e.target.dataset.permlink));
        });
        appContainer.addEventListener('click', function(e) {
            const voteBtn = e.target.closest('.vote-btn');
            if (voteBtn) handleVoteClick(voteBtn);
            const replyBtn = e.target.closest('.reply-to-btn');
            if (replyBtn) {
                const { author, permlink } = replyBtn.dataset;
                const formContainer = replyBtn.closest('.col-md-9').querySelector('.reply-form-container');
                renderReplyForm(author, permlink, formContainer);
            }
        });
    }

    startPostViewPoller(user, author, permlink);
    hideLoader();
}

function createEditor(element, options = {}) {
    const editorOptions = {
        element: element,
        spellChecker: false,
        toolbar: [
            'bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', 
            {
                name: "upload-image",
                action: (editor) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        handleImageUpload(editor, file);
                    };
                    input.click();
                },
                className: "fa fa-image",
                title: "Upload Image",
            },
            '|', 'preview', 'side-by-side', 'fullscreen', '|', 'guide'
        ],
        ...options
    };

    const mde = new EasyMDE(editorOptions);
    const cm = mde.codemirror;

    cm.on('paste', (cm, event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                handleImageUpload(mde, file);
                break;
            }
        }
    });

    cm.on('drop', (cm, event) => {
        const items = event.dataTransfer.items;
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                handleImageUpload(mde, file);
                break;
            }
        }
    });

    return mde;
}

function handleImageUpload(editor, file) {
    const cm = editor.codemirror;
    const placeholder = `![Uploading ${file.name}...]()`;
    cm.replaceSelection(placeholder);

    const progressCallback = (progress) => {
        if (progress.message) {
            Toastify({ text: progress.message, duration: 2000 }).showToast();
        }
        if (progress.error) {
            Toastify({ text: `Upload Error: ${progress.error}`, backgroundColor: 'red' }).showToast();
            const currentText = cm.getValue();
            cm.setValue(currentText.replace(placeholder, `![Upload failed for ${file.name}]()`));
        }
        if (progress.url) {
            Toastify({ text: 'Image uploaded successfully!', backgroundColor: 'green' }).showToast();
            const newText = `![${file.name}](${progress.url})`;
            const currentText = cm.getValue();
            cm.setValue(currentText.replace(placeholder, newText));
        }
    };

    uploadImage(file, progressCallback).catch(err => {
        // The error is already handled in the callback, but we catch it here to prevent unhandled promise rejections.
        console.error("Final upload error:", err);
    });
}

function renderReplyForm(parentAuthor, parentPermlink, container) {
    if (easyMDEInstance) {
        try { easyMDEInstance.toTextArea(); } catch(e) {}
        easyMDEInstance = null;
    }
    const existingForm = document.getElementById('reply-form');
    if (existingForm) existingForm.parentElement.innerHTML = '';

    const formHtml = `
        <form id="reply-form" class="mt-3 mb-3 card card-body">
            <h4>Reply to @${parentAuthor}</h4>
            <div class="mb-3"><textarea class="form-control" id="reply-body" rows="5"></textarea></div>
            <div id="reply-error" class="alert alert-danger d-none"></div>
            <button type="submit" class="btn btn-primary">Submit Reply</button>
            <button type="button" class="btn btn-secondary mt-2" id="cancel-reply">Cancel</button>
        </form>`;
    
    if (container) {
        container.innerHTML = formHtml;
        easyMDEInstance = createEditor(document.getElementById('reply-body'), { placeholder: "Enter your reply..." });
        document.getElementById('reply-form').addEventListener('submit', (e) => handleReplySubmit(e, parentAuthor, parentPermlink));
        document.getElementById('cancel-reply').addEventListener('click', () => {
            if (easyMDEInstance) {
                try { easyMDEInstance.toTextArea(); } catch(e) {}
                easyMDEInstance = null;
            }
            container.innerHTML = '';
        });
        easyMDEInstance.codemirror.focus();
    } else {
        console.error(`Could not find container for reply form to ${parentPermlink}`);
    }
}

function startPostViewPoller(user, author, permlink) {
    if (postViewPoller) clearInterval(postViewPoller);
    const renderVotes = async () => {
        const data = await blockchain.getPostAndDirectReplies(author, permlink);
        if (!data || !data.post) return;
        const allContent = [data.post, ...data.replies];
        allContent.forEach(content => {
            if (!content) return;
            const voteContainer = document.querySelector(`.vote-section[data-permlink="${content.permlink}"]`);
            if (!voteContainer) return;
            const userVoted = user && content.active_votes.some(v => v.voter === user);
            const votersList = content.active_votes.map(v => `@${v.voter}`).join('<br>');
            const newHtml = `
                ${user ? `<button class="btn btn-sm ${userVoted ? 'btn-success' : 'btn-outline-success'} me-2 vote-btn" data-author="${content.author}" data-permlink="${content.permlink}"><i class="fas fa-thumbs-up"></i> <span>${userVoted ? 'Unvote' : 'Upvote'}</span></button>` : ''}
                <button type="button" class="btn btn-link text-muted text-decoration-none p-0 vote-popover" data-bs-toggle="popover" data-bs-html="true" title="${content.active_votes.length} Voters" data-bs-content="${votersList || 'No votes yet.'}">
                    ${content.title ? `Pending Payout: ${content.pending_payout_value}` : `<small>Payout: ${content.pending_payout_value}</small>`}
                </button>`;
            voteContainer.innerHTML = newHtml;
        });
        appContainer.querySelectorAll('[data-bs-toggle="popover"]').forEach(el => new window.bootstrap.Popover(el));
    };
    currentRenderVotes = renderVotes;
    renderVotes();
    postViewPoller = setInterval(renderVotes, 5000);
}

function renderNewTopicForm(categoryId) {
    if (easyMDEInstance) {
        try { easyMDEInstance.toTextArea(); } catch(e) {}
        easyMDEInstance = null;
    }

    const category = getAllCategories().find(c => c.id === categoryId);
    if (!category) { renderNotFound(); return; }
    if (!auth.getCurrentUser()) { renderError("You must be logged in to create a new topic."); return; }

    document.title = `New Topic in ${category.title} - ${CONFIG.forum_title}`;
    const draftKey = `draft-new-${categoryId}`;

    appContainer.innerHTML = `
        <h2>New Topic in ${category.title}</h2>
        <form id="new-topic-form">
            <div class="mb-3"><label for="topic-title" class="form-label">Title</label><input type="text" class="form-control" id="topic-title"></div>
            <div class="mb-3"><label for="topic-body" class="form-label">Content</label><textarea class="form-control" id="topic-body" rows="10"></textarea></div>
            <div id="post-error" class="alert alert-danger d-none"></div>
            <button type="submit" class="btn btn-primary">Submit Topic</button>
            <a href="?category=${categoryId}" class="btn btn-secondary">Cancel</a>
        </form>`;

    const titleEl = document.getElementById('topic-title');
    const bodyEl = document.getElementById('topic-body');

    easyMDEInstance = createEditor(bodyEl, {
        placeholder: "Enter your content here...",
        autosave: { enabled: true, uniqueId: draftKey, delay: 1000 },
    });

    const fullDraftKey = `full-draft-${draftKey}`;
    const savedDraft = localStorage.getItem(fullDraftKey);
    if (savedDraft) {
        try {
            const draft = JSON.parse(savedDraft);
            titleEl.value = draft.title || '';
            easyMDEInstance.value(draft.body || '');
        } catch (e) { 
            easyMDEInstance.value(localStorage.getItem(draftKey) || '');
        }
    }

    const saveFullDraft = () => {
        const draft = { title: titleEl.value, body: easyMDEInstance.value() };
        localStorage.setItem(fullDraftKey, JSON.stringify(draft));
    };
    titleEl.addEventListener('input', saveFullDraft);
    easyMDEInstance.codemirror.on('change', saveFullDraft);

    document.getElementById('new-topic-form').addEventListener('submit', (e) => handlePostSubmit(e, fullDraftKey));
}

async function renderEditView(author, permlink) {
    if (easyMDEInstance) {
        try { easyMDEInstance.toTextArea(); } catch(e) {}
        easyMDEInstance = null;
    }
    appContainer.innerHTML = '<div class="text-center mt-5"><div class="spinner-border"></div></div>';

    const post = await blockchain.getPostWithReplies(author, permlink);
    if (!post || post.author !== auth.getCurrentUser()) {
        renderError("You do not have permission to edit this.");
        return;
    }

    document.title = `Editing: ${post.title || 'Reply'}`;
    const draftKey = `draft-edit-${post.author}-${post.permlink}`;

    appContainer.innerHTML = `
        <h2>Editing ${post.title ? 'Topic' : 'Reply'}</h2>
        <form id="edit-form">
            ${post.title ? `<div class="mb-3"><label for="edit-title" class="form-label">Title</label><input type="text" class="form-control" id="edit-title"></div>` : ''}
            <div class="mb-3"><label for="edit-body" class="form-label">Content</label><textarea id="edit-body" rows="10"></textarea></div>
            <div id="edit-error" class="alert alert-danger d-none"></div>
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <a href="?post=@${author}/${permlink}" class="btn btn-secondary">Cancel</a>
        </form>`;
    
    const titleEl = document.getElementById('edit-title');
    const bodyEl = document.getElementById('edit-body');

    easyMDEInstance = createEditor(bodyEl, {
        autosave: { enabled: true, uniqueId: draftKey, delay: 1000 }
    });

    const savedDraft = localStorage.getItem(draftKey);
    easyMDEInstance.value(savedDraft || post.body);

    if (titleEl) {
        const savedTitleKey = `${draftKey}-title`;
        const savedTitle = localStorage.getItem(savedTitleKey);
        titleEl.value = savedTitle || post.title;
        titleEl.addEventListener('input', () => localStorage.setItem(savedTitleKey, titleEl.value));
    }

    document.getElementById('edit-form').addEventListener('submit', (e) => handleEditSubmit(e, post, draftKey));
}


function renderError(message) {
    appContainer.innerHTML = `<div class="alert alert-danger">${message}</div><a href="/">Back to Home</a>`;
    hideLoader();
}

function renderNotFound() {
    appContainer.innerHTML = `
        <div class="alert alert-danger"><strong>404 Not Found</strong><p>The page you requested could not be found.</p></div>
        <a href="/">Back to Home</a>`;
    document.title = `Not Found - ${CONFIG.forum_title}`;
    hideLoader();
}

// --- ROUTER & INITIALIZATION ---

function handleRouteChange() {
    if (postViewPoller) {
        clearInterval(postViewPoller);
        postViewPoller = null;
        currentRenderVotes = null;
    }

    if (easyMDEInstance) {
        try { easyMDEInstance.toTextArea(); } catch(e) {}
        easyMDEInstance = null;
    }

    appContainer.innerHTML = ''; // Clear the page before loading new content

    const params = new URLSearchParams(window.location.search);
    const categoryId = params.get('category');
    const postLink = params.get('post');
    const newTopicCategory = params.get('new_topic_in');
    const editLink = params.get('edit');
    const profileUsername = params.get('profile');

    if (postLink) {
        const [author, permlink] = postLink.startsWith('@') ? postLink.substring(1).split('/') : postLink.split('/');
        renderPostView(author, permlink);
    } else if (categoryId) {
        renderCategoryView(categoryId);
    } else if (newTopicCategory) {
        renderNewTopicForm(newTopicCategory);
    } else if (editLink) {
        const [author, permlink] = editLink.startsWith('@') ? editLink.substring(1).split('/') : editLink.split('/');
        renderEditView(author, permlink);
    } else if (profileUsername) {
        renderProfileView(profileUsername);
    } else {
        renderMainView();
    }
}

// --- THEME & SETTINGS LOGIC ---

const BOOTSWATCH_THEMES = ['default', 'cerulean', 'cosmo', 'cyborg', 'darkly', 'flatly', 'journal', 'litera', 'lumen', 'lux', 'materia', 'minty', 'pulse', 'sandstone', 'simplex', 'sketchy', 'slate', 'solar', 'spacelab', 'superhero', 'united', 'yeti'];

function applyTheme(themeName) {
    const themeUrl = themeName === 'default' 
        ? 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css' 
        : `https://cdn.jsdelivr.net/npm/bootswatch@5.3.2/dist/${themeName}/bootstrap.min.css`;
    
    document.getElementById('theme-css').setAttribute('href', themeUrl);
}

function setupConfigModal() {
    const rpcNodeSelect = document.getElementById('rpc-node-select');
    const useCoalCheckbox = document.getElementById('use-coal');
    const themeSelector = document.getElementById('theme-selector');

    // Populate RPC nodes from config
    CONFIG.RPC_NODES.forEach(node => {
        const option = new Option(node, node);
        rpcNodeSelect.add(option);
    });

    // Populate themes
    BOOTSWATCH_THEMES.forEach(theme => {
        const option = new Option(theme.charAt(0).toUpperCase() + theme.slice(1), theme);
        themeSelector.add(option);
    });

    // Load current settings into the form
    rpcNodeSelect.value = settings.getSetting('RPC_URL');
    useCoalCheckbox.checked = settings.getSetting('USE_COAL');
    themeSelector.value = settings.getSetting('THEME');

    // Save handler
    document.getElementById('save-config').addEventListener('click', () => {
        const newSettings = {
            RPC_URL: rpcNodeSelect.value,
            USE_COAL: useCoalCheckbox.checked,
            THEME: themeSelector.value
        };
        settings.saveSettings(newSettings);
        applyTheme(newSettings.THEME);
        Toastify({ text: "Settings saved! Reloading to apply all changes...", backgroundColor: "green" }).showToast();
        
        // Reload the page to apply RPC and blacklist settings
        setTimeout(() => window.location.reload(), 1500);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    settings.initSettings();
    blockchain.initBlockchain();
    applyTheme(settings.getSetting('THEME'));

    await blacklist.initBlacklist();
    await beneficiaries.initBeneficiaries();

    auth.initAuth();
    updateAuthUI();
    setupConfigModal();
    
    loginForm.addEventListener('submit', handleLogin);

    document.body.addEventListener('click', e => {
        // Handle notification bell clicks
        const bellBtn = e.target.closest('.notification-bell');
        if (bellBtn) {
            e.preventDefault();
            const { author, permlink, currentReplies } = bellBtn.dataset;
            localStorage.setItem(`notification-cache-${author}-${permlink}`, currentReplies);

            const readIconContainer = document.createElement('div');
            readIconContainer.className = 'text-center me-4 d-flex align-items-center';
            readIconContainer.title = 'No new replies';
            readIconContainer.innerHTML = `<i class="fa-regular fa-bell-slash text-muted fs-2 fa-fw"></i>`;

            bellBtn.parentElement.replaceWith(readIconContainer);
            Toastify({ text: "Marked as read.", duration: 2000 }).showToast();
            return; // Stop further processing
        }

        // If the click is not on a popover trigger or inside a popover, hide all popovers
        if (!e.target.closest('[data-bs-toggle="popover"]') && !e.target.closest('.popover')) {
            document.querySelectorAll('[data-bs-toggle="popover"]').forEach(popoverEl => {
                const popover = bootstrap.Popover.getInstance(popoverEl);
                if (popover) popover.hide();
            });
        }

        const anchor = e.target.closest('a');
        if (!anchor) return;

        // Allow default behavior for in-page anchor links
        if (anchor.hash && anchor.pathname === window.location.pathname && anchor.search === window.location.search) {
            return;
        }

        // Prevent default for modal triggers OR dropdown triggers

        if ((anchor.href.includes('?category=') || anchor.href.includes('?post=') || anchor.href.includes('?new_topic_in=') || anchor.href.includes('?edit=') || anchor.href.includes('?profile=') || anchor.pathname === '/')) {
            const url = new URL(anchor.href);
            if (url.origin === window.location.origin) {
                e.preventDefault();
                history.pushState({}, '', anchor.href);
                handleRouteChange();
            }
        }
    });

    const categoryList = document.getElementById('new-post-category-list');
    if (categoryList) {
        getAllCategories().forEach(cat => {
            const link = document.createElement('a');
            link.href = `?new_topic_in=${cat.id}`;
            link.className = 'list-group-item list-group-item-action';
            link.textContent = cat.title;
            link.onclick = (e) => {
                e.preventDefault();
                const modal = bootstrap.Modal.getInstance(document.getElementById('newPostModal'));
                modal.hide();
                history.pushState({}, '', link.href);
                handleRouteChange();
            };
            categoryList.appendChild(link);
        });
    }

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('pageshow', function(event) {
        if (event.persisted) {
            console.log("Page restored from bfcache. Forcing route change.");
            handleRouteChange();
        }
    });
    handleRouteChange();
});