import { BrowserRouter, Routes, Route } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useEffect } from "react"
import { ws } from "@/ws"
import ProjectPicker from "@/pages/ProjectPicker"
import IssuesView from "@/pages/IssuesView"
import IssueDetail from "@/pages/IssueDetail"
import ProjectSettings from "@/pages/ProjectSettings"

function App() {
  useEffect(() => {
    ws.connect()
    return () => ws.disconnect()
  }, [])

  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectPicker />} />
          <Route path="/project/:name" element={<IssuesView />} />
          <Route path="/project/:name/settings" element={<ProjectSettings />} />
          <Route
            path="/project/:name/issues/:issueNumber"
            element={<IssueDetail />}
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}

export default App
