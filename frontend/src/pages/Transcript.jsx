import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import toast from "react-hot-toast"
import { FiUploadCloud } from "react-icons/fi"
import { MdOutlineTranslate } from "react-icons/md"

const API = import.meta.env.VITE_BACKEND_URL

const LANGUAGES = [
  { code: "auto", name: "Auto Detect" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  // ...add more as needed
]

export default function Transcript() {
  const [file, setFile] = useState(null)
  const [lang, setLang] = useState("auto")
  const [uploading, setUploading] = useState(false)
  const [uploadedFilename, setUploadedFilename] = useState(null)
  const [transcribing, setTranscribing] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileChange = async e => {
    const selectedFile = e.target.files[0]
    setFile(selectedFile)
    setUploadedFilename(null)
    setResult(null)
    if (!selectedFile) return
    setUploading(true)
    toast.loading("Uploading...", { id: "uploading" })
    try {
      const fd = new FormData()
      fd.append("file", selectedFile)
      const upload = await fetch(`${API}/api/upload-audio`, {
        method: "POST",
        body: fd
      }).then(r => r.json())
      if (!upload.filename) throw new Error("Upload failed")
      setUploadedFilename(upload.filename)
      toast.success("Upload complete", { id: "uploading" })
    } catch (err) {
      toast.error(err.message || "Failed to upload", { id: "uploading" })
      setUploadedFilename(null)
    } finally {
      setUploading(false)
    }
  }

  const uploadAndTranscribe = async () => {
    if (!uploadedFilename) {
      toast.error("No uploaded file.")
      return
    }
    setTranscribing(true)
    try {
      const transcribe = await fetch(`${API}/api/transcribe?filename=${uploadedFilename}${lang && lang !== "auto" ? `&language=${lang}` : ""}`)
        .then(r => r.json())
      if (transcribe.transcription) {
        setResult(transcribe.transcription)
        toast.success("Transcription complete!")
      } else {
        throw new Error(transcribe.error || "Transcription failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to transcribe")
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-auto p-8 flex flex-col gap-6 items-center shadow-lg">
        <div className="flex flex-col items-center gap-1 mb-2">
          <FiUploadCloud className="text-primary size-10 mb-1" />
          <h2 className="text-2xl font-bold">Audio Transcription</h2>
          <p className="text-muted-foreground text-sm">Upload an audio file and get the transcript in seconds.</p>
        </div>
        <div className="w-full flex flex-col gap-4">
          <Label htmlFor="audio-upload">Audio File</Label>
          <Input
            id="audio-upload"
            type="file"
            accept="audio/*"
            disabled={uploading || transcribing}
            className="cursor-pointer"
            onChange={handleFileChange}
          />
          <Label htmlFor="language-select" className="flex items-center gap-2">
            <MdOutlineTranslate className="inline-block" /> Language
          </Label>
          <Select value={lang} onValueChange={setLang} disabled={uploading || transcribing}>
            <SelectTrigger id="language-select" className="w-full">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(l => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-full flex flex-col gap-2">
            <Button
              className="w-full"
              onClick={uploadAndTranscribe}
              disabled={!uploadedFilename || transcribing || uploading}
            >
              {transcribing ? "Transcribing..." : "Transcribe"}
            </Button>
            {result && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const blob = new Blob([
                    JSON.stringify(result, null, 2)
                  ], { type: "application/json" })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = "transcript.json"
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Download JSON
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
