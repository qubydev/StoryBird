import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FaArrowLeft, FaVideo, FaFileUpload, FaTimes, FaDownload, FaMusic } from 'react-icons/fa'
import toast from 'react-hot-toast'

export default function Render() {
    const navigate = useNavigate()
    const [jsonFile, setJsonFile] = useState(null)
    const [audioFile, setAudioFile] = useState(null)
    const [isExporting, setIsExporting] = useState(false)
    const [videoUrl, setVideoUrl] = useState(null)

    const abortControllerRef = useRef(null)

    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

    const handleJsonChange = (e) => {
        const file = e.target.files[0]
        if (file && file.type === 'application/json') {
            setJsonFile(file)
            setVideoUrl(null)
        } else {
            toast.error('Please upload a valid JSON file')
        }
    }

    const handleAudioChange = (e) => {
        const file = e.target.files[0]
        if (file && file.type.startsWith('audio/')) {
            setAudioFile(file)
        } else {
            toast.error('Please upload a valid audio file')
        }
    }

    const removeJson = () => setJsonFile(null)
    const removeAudio = () => setAudioFile(null)

    const handleExport = async () => {
        if (!jsonFile) return

        setIsExporting(true)
        setVideoUrl(null)

        const toastId = toast.loading('Starting export...')

        const formData = new FormData()
        formData.append('file', jsonFile)
        if (audioFile) {
            formData.append('audio', audioFile)
        }

        try {
            abortControllerRef.current = new AbortController()

            const response = await fetch(`${BACKEND_URL}/api/export-video`, {
                method: 'POST',
                body: formData,
                signal: abortControllerRef.current.signal
            })

            if (!response.ok) {
                throw new Error('Connection failed')
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop()

                for (const line of lines) {
                    if (!line.trim().startsWith('data:')) continue

                    const rawJson = line.replace('data:', '').trim()
                    if (!rawJson) continue

                    try {
                        const data = JSON.parse(rawJson)

                        if (data.error) throw new Error(data.error)

                        if (data.status === 'processing') {
                            toast.loading(data.message || 'Processing...', { id: toastId })
                        }

                        if (data.status === 'done') {
                            toast.success('Video Ready!', { id: toastId })
                            setVideoUrl(`${BACKEND_URL}${data.video_url}`)
                            setIsExporting(false)
                            return
                        }
                    } catch (err) {
                        if (
                            err.message !== 'Unexpected end of JSON input' &&
                            !err.message.includes('Unexpected token')
                        ) {
                            throw err
                        }
                    }
                }
            }
        } catch (error) {
            toast.error(error.message || 'Export failed', { id: toastId })
            setIsExporting(false)
        }
    }

    const handleDownload = async () => {
        if (!videoUrl) return

        const downloadToast = toast.loading('Downloading...')
        try {
            const response = await fetch(videoUrl)
            const blob = await response.blob()
            const url = window.URL.createObjectURL(blob)

            const a = document.createElement('a')
            a.href = url
            a.download = videoUrl.split('/').pop() || 'exported_project.mp4'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            window.URL.revokeObjectURL(url)

            toast.dismiss(downloadToast)
        } catch (error) {
            toast.error('Download failed', { id: downloadToast })
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative px-6 py-12">
            <Button
                variant="ghost"
                size="icon"
                className="absolute top-6 left-6 bg-white shadow-sm rounded-full"
                onClick={() => navigate('/')}
                disabled={isExporting}
            >
                <FaArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex flex-col items-center justify-center w-full max-w-2xl">
                <div className="flex items-center justify-center gap-3 mb-8">
                    <FaVideo className="h-6 w-6 text-primary" />
                    <h1 className="text-lg font-semibold tracking-wide text-primary">
                        RENDER PROJECT
                    </h1>
                </div>

                <Card className="w-full p-6 space-y-6 bg-white shadow-xl rounded-2xl border mb-6">
                    <div className="space-y-4">
                        <label className={`group flex items-center justify-between gap-4 border-2 border-dashed rounded-lg px-5 py-4 cursor-pointer transition-all ${jsonFile ? 'border-green-500 bg-green-50' : 'border-border hover:border-primary hover:bg-accent/40'} ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="flex items-center gap-4">
                                <FaFileUpload className={`h-5 w-5 transition-colors ${jsonFile ? 'text-green-600' : 'text-muted-foreground group-hover:text-primary'}`} />
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">{jsonFile ? jsonFile.name : 'Upload Project JSON'}</span>
                                    <span className="text-xs text-muted-foreground tracking-tight">Required format</span>
                                </div>
                            </div>
                            {jsonFile && !isExporting && (
                                <Button type="button" size="icon" variant="ghost" onClick={(e) => { e.preventDefault(); removeJson(); }} className="h-7 w-7 text-green-700 hover:text-red-500">
                                    <FaTimes className="h-3 w-3" />
                                </Button>
                            )}
                            <input type="file" className="hidden" accept=".json" onChange={handleJsonChange} disabled={isExporting} />
                        </label>

                        <label className={`group flex items-center justify-between gap-4 border-2 border-dashed rounded-lg px-5 py-4 cursor-pointer transition-all ${audioFile ? 'border-blue-500 bg-blue-50' : 'border-border hover:border-primary hover:bg-accent/40'} ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="flex items-center gap-4">
                                <FaMusic className={`h-5 w-5 transition-colors ${audioFile ? 'text-blue-600' : 'text-muted-foreground group-hover:text-primary'}`} />
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">{audioFile ? audioFile.name : 'Upload Audio (Optional)'}</span>
                                    <span className="text-xs text-muted-foreground tracking-tight">Voiceover or Background Music</span>
                                </div>
                            </div>
                            {audioFile && !isExporting && (
                                <Button type="button" size="icon" variant="ghost" onClick={(e) => { e.preventDefault(); removeAudio(); }} className="h-7 w-7 text-blue-700 hover:text-red-500">
                                    <FaTimes className="h-3 w-3" />
                                </Button>
                            )}
                            <input type="file" className="hidden" accept="audio/*" onChange={handleAudioChange} disabled={isExporting} />
                        </label>

                        <Button className="w-full h-12 text-md font-medium shadow-md transition-all active:scale-[0.98]" disabled={!jsonFile || isExporting} onClick={handleExport}>
                            {isExporting ? 'Exporting Video...' : '🚀 Export Video'}
                        </Button>
                    </div>

                    {videoUrl && (
                        <div className="pt-6 border-t space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="rounded-xl overflow-hidden shadow-2xl bg-black border aspect-video flex items-center justify-center">
                                <video src={videoUrl} controls className="w-full h-full" />
                            </div>

                            <Button variant="outline" className="w-full h-11 border-primary/20 hover:bg-primary/5" onClick={handleDownload}>
                                <FaDownload className="mr-2 h-4 w-4" />
                                Download MP4
                            </Button>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    )
}