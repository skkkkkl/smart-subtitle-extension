'use strict';

(function () {
  const video = document.getElementById('demo-video');
  const input = document.getElementById('video-file');
  const empty = document.querySelector('[data-role="video-empty"]');
  const name = document.querySelector('[data-role="video-name"]');
  const addButton = document.getElementById('add-video');
  const resetButton = document.getElementById('reset-demo');
  const extra = document.getElementById('extra-videos');
  let objectUrl = null;
  let secondCount = 0;

  function revokeOld() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    revokeOld();
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
    empty.classList.add('is-hidden');
    name.textContent = '当前视频：' + file.name;
  });

  addButton.addEventListener('click', function () {
    secondCount += 1;
    const extraVideo = document.createElement('video');
    extraVideo.controls = true;
    extraVideo.playsInline = true;
    extraVideo.dataset.demoVideo = String(secondCount);
    extraVideo.setAttribute('aria-label', '演示视频 ' + secondCount);

    // Intentionally left without a source: it is here to exercise the
    // extension's MutationObserver and multi-video selector.
    extra.appendChild(extraVideo);
    addButton.textContent = '再添加一个视频';
  });

  resetButton.addEventListener('click', function () {
    window.location.reload();
  });

  window.addEventListener('pagehide', function () {
    revokeOld();
  });
})();
