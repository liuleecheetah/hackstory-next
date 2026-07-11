// ui 層：頁面外殼。M0 階段只顯示專案標題。
export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
      <h1 className="text-5xl font-bold tracking-wide text-slate-800">HackStory</h1>
      <p className="mt-4 text-lg text-slate-500">多人協作的視覺化時間軸工具</p>
    </main>
  )
}
