const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  // --- Main Sidebar Tab Switching ---
  const mainNavButtons = document.querySelectorAll('.nav-menu .nav-btn');
  const mainTabPanes = document.querySelectorAll('.main-content > .tab-pane');

  mainNavButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      mainNavButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      mainTabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === `tab-${targetTab}`) pane.classList.add('active');
      });
    });
  });

  // --- Inner Settings Menu Switching ---
  const settingsNavButtons = document.querySelectorAll('.settings-nav-btn');
  const settingsSections = document.querySelectorAll('.settings-section');

  settingsNavButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetSection = button.getAttribute('data-settings');
      settingsNavButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      settingsSections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `settings-${targetSection}`) section.classList.add('active');
      });
    });
  });

  const feedback = document.getElementById('account-feedback');
  const inbox = document.getElementById('gmail-inbox');
  let isSyncingGmail = false;

  function setFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', isError);
  }

  function readableError(error) {
    return (error?.message || 'The account request failed.')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '');
  }

  function renderAccounts(result) {
    const accounts = result.accounts || {};
    const preferredAccount = accounts.gmail?.account || accounts.slack?.account || accounts.linkedin?.account || accounts.clickup?.account;
    const displayName = preferredAccount?.name || result.username || 'OmniDesk User';
    document.getElementById('profile-display-name').textContent = displayName;
    document.getElementById('profile-full-name').textContent = displayName;
    document.getElementById('profile-username').textContent = result.username || 'Signed in';
    document.getElementById('profile-email').textContent = preferredAccount?.email || 'Connect an account to display your email';
    document.querySelector('.settings-user-info .avatar').textContent = displayName.trim().charAt(0).toUpperCase() || 'U';

    document.querySelectorAll('.account-row').forEach(row => {
      const provider = row.dataset.provider;
      const saved = accounts[provider];
      const homeState = document.getElementById(`home-${provider}-state`);
      const identity = row.querySelector('.account-email');
      const button = row.querySelector('.account-connect');
      if (saved?.connected) {
        identity.textContent = saved.account?.email || saved.account?.name || 'Connected';
        button.textContent = 'Remove';
        button.classList.add('account-disconnect');
        if (homeState) homeState.textContent = saved.account?.email || saved.account?.name || 'Connected';
      } else {
        identity.textContent = 'Not connected';
        button.textContent = 'Connect';
        button.classList.remove('account-disconnect');
        if (homeState) homeState.textContent = 'Not connected';
      }
    });
    inbox.hidden = !accounts.gmail?.connected;
  }

  async function loadAccounts() {
    try { renderAccounts(await ipcRenderer.invoke('get-connected-accounts')); }
    catch (error) { setFeedback(readableError(error) || 'Could not load connected accounts.', true); }
  }

  async function syncGmail(showFeedback = true) {
    if (isSyncingGmail) return;
    isSyncingGmail = true;
    const syncButton = document.getElementById('btn-sync-gmail');
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing…';
    try {
      const result = await ipcRenderer.invoke('sync-gmail');
      const list = document.getElementById('gmail-message-list');
      list.replaceChildren();
      if (!result.emails.length) {
        const empty = document.createElement('p');
        empty.className = 'inbox-empty';
        empty.textContent = 'No inbox messages were returned.';
        list.append(empty);
      }
      result.emails.forEach(email => {
        const item = document.createElement('article');
        item.className = `gmail-message${email.unread ? ' unread' : ''}`;
        const copy = document.createElement('div');
        copy.className = 'gmail-message-copy';
        const subject = document.createElement('strong');
        subject.textContent = email.subject;
        const sender = document.createElement('span');
        sender.textContent = email.from;
        const snippet = document.createElement('p');
        snippet.textContent = email.snippet;
        copy.append(subject, sender, snippet);
        const date = document.createElement('time');
        date.textContent = email.date ? new Date(email.date).toLocaleDateString() : '';
        item.append(copy, date);
        list.append(item);
      });
      document.getElementById('gmail-sync-time').textContent = `Synced ${new Date(result.syncedAt).toLocaleTimeString()} · ${result.unreadCount} unread in this view`;
      document.getElementById('home-gmail-state').textContent = `${result.unreadCount} unread in latest ${result.emails.length}`;
      if (showFeedback) setFeedback('Gmail inbox updated.');
    } catch (error) {
      if (showFeedback) setFeedback(readableError(error) || 'Gmail sync failed.', true);
    } finally {
      isSyncingGmail = false;
      syncButton.disabled = false;
      syncButton.textContent = 'Sync now';
    }
  }

  document.querySelectorAll('.account-connect').forEach(button => {
    button.addEventListener('click', async () => {
      const provider = button.dataset.provider;
      const shouldDisconnect = button.classList.contains('account-disconnect');
      button.disabled = true;
      button.textContent = shouldDisconnect ? 'Disconnecting…' : 'Opening sign-in…';
      setFeedback('');
      try {
        if (shouldDisconnect) {
          await ipcRenderer.invoke('disconnect-account', provider);
          await loadAccounts();
          setFeedback(`${provider[0].toUpperCase()}${provider.slice(1)} removed from this device. You can revoke OmniDesk access in that provider's security settings.`);
        } else {
          await ipcRenderer.invoke('connect-account', provider);
          await loadAccounts();
          setFeedback('Account connected successfully.');
          if (provider === 'gmail') await syncGmail(false);
        }
      } catch (error) {
        setFeedback(readableError(error) || 'Account connection failed.', true);
        await loadAccounts();
      } finally {
        button.disabled = false;
      }
    });
  });

  document.getElementById('btn-sync-gmail').addEventListener('click', () => syncGmail());
  loadAccounts().then(() => {
    if (!inbox.hidden) syncGmail(false);
  });
  window.setInterval(() => {
    if (!inbox.hidden) syncGmail(false);
  }, 60000);
});
