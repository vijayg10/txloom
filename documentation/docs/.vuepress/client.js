import { defineClientConfig } from 'vuepress/client'
import VideoPlayer from './components/VideoPlayer.vue'

export default defineClientConfig({
  enhance({ app }) {
    app.component('VideoPlayer', VideoPlayer)
  },
})
