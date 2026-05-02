(function initBroadcastFeature() {
  const features = (window.features = window.features || {});
  console.log('Broadcast Loaded');

  const defaultPalette = {
    light: { bg: '#fff3cd', text: '#856404' },
    dark: { bg: '#1e293b', text: '#facc15' },
  };

  function enhanceBroadcastCards() {
    document.querySelectorAll('.broadcast').forEach((node) => {
      const defaultBg = node.dataset.defaultBg || '';
      const defaultText = node.dataset.defaultText || '';
      const bgColor = node.dataset.bgColor || defaultBg;
      const textColor = node.dataset.textColor || defaultText;
      if (bgColor) node.style.background = bgColor;
      if (textColor) node.style.color = textColor;
    });
  }

  const observer = new MutationObserver(enhanceBroadcastCards);
  observer.observe(document.body, { subtree: true, childList: true });
  enhanceBroadcastCards();

  window.broadcastFeature = {
    personalizeMessage(user, message) {
      const name = user?.firstName ?? user?.name ?? 'there';
      return `Hi ${name} 👋, ${message}`;
    },
    resolveTargets(isGlobal, selectedUsers, getAllUsers) {
      return isGlobal ? getAllUsers() : selectedUsers;
    },
    defaultPalette,
    enabled: features.broadcastV2 !== false,
  };
})();
