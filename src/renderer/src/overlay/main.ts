// 0단계 자리 표시: 화면 가운데에 웜홀 하나를 3초 보여 준다
const canvas = document.getElementById('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
window.overlayApi.onInit((init) => {
  canvas.width = init.bounds.w
  canvas.height = init.bounds.h
  const t0 = performance.now()
  const draw = (): void => {
    const t = (performance.now() - t0) / 1000
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (t > 3) return
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + t * 3
      ctx.fillStyle = i % 2 ? '#b06cff' : '#5cecdc'
      ctx.fillRect(Math.round(cx + Math.cos(a) * 40) - 3, Math.round(cy + Math.sin(a) * 40) - 3, 6, 6)
    }
    requestAnimationFrame(draw)
  }
  draw()
})
window.overlayApi.ready()
