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

  // --- External Tool Authentication Triggers ---
  const slackAuthBtn = document.getElementById('btn-auth-slack');
  const clickupAuthBtn = document.getElementById('btn-auth-clickup');

  if (slackAuthBtn) {
    slackAuthBtn.addEventListener('click', () => {
      slackAuthBtn.innerText = "Processing...";
      ipcRenderer.send('start-oauth', 'slack');
    });
  }

  if (clickupAuthBtn) {
    clickupAuthBtn.addEventListener('click', () => {
      clickupAuthBtn.innerText = "Processing...";
      ipcRenderer.send('start-oauth', 'clickup');
    });
  }
});