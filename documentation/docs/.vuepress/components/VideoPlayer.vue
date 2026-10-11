<template>
  <video
    :src="resolvedSrc"
    :poster="resolvedPoster"
    :controls="controls"
    :autoplay="autoplay"
    :muted="muted"
    :loop="loop"
    :preload="preload"
    :style="style"
    width="100%"
  >
    Your browser does not support the video tag.
  </video>
</template>

<script setup>
import { computed } from 'vue'
import { withBase } from 'vuepress/client'

const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, default: '' },
  controls: { type: Boolean, default: true },
  autoplay: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  loop: { type: Boolean, default: false },
  // 'metadata' fetches just enough to render the poster/duration without
  // pulling the whole file until the user (or autoplay) starts playback.
  preload: { type: String, default: 'metadata' },
  style: {
    type: String,
    default: 'border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.12); margin: 1rem 0;'
  },
})

// Resolve absolute (public) paths against the site `base` so URLs stay correct
// on GitHub Pages (e.g. /videos/x.mp4 -> /txloom/videos/x.mp4).
const withSiteBase = (p) => (p && p.startsWith('/') ? withBase(p) : p)
const resolvedSrc = computed(() => withSiteBase(props.src))
const resolvedPoster = computed(() => withSiteBase(props.poster) || undefined)
</script>
