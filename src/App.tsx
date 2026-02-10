import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthGate } from "@/components/AuthGate"
import { ProjectPicker } from "@/pages/ProjectPicker"
import { IssuesView } from "@/pages/IssuesView"
import { IssueDetail } from "@/pages/IssueDetail"

function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectPicker />} />
          <Route path="/project/:owner/:repo" element={<IssuesView />} />
          <Route path="/project/:owner/:repo/issues/:issueNumber" element={<IssueDetail />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
