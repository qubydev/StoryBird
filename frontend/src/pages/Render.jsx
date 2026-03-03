import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FaArrowLeft, FaVideo, FaMusic, FaFileUpload, FaTimes } from 'react-icons/fa'

export default function Render() {
    const navigate = useNavigate()
    const [jsonFile, setJsonFile] = useState(null)
    const [audioFile, setAudioFile] = useState(null)

    const handleJsonChange = (e) => {
        const file = e.target.files[0]
        if (file && file.type === 'application/json') {
            setJsonFile(file)
        }
    }

    const handleAudioChange = (e) => {
        const file = e.target.files[0]
        if (file) {
            setAudioFile(file)
        }
    }

    const handleExport = () => {
        if (!jsonFile) return
        console.log('Exporting:', { jsonFile, audioFile })
    }

    const removeJson = () => {
        setJsonFile(null)
    }

    const removeAudio = () => {
        setAudioFile(null)
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 relative">

            <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/')}
                className="absolute top-6 left-6 rounded-full shadow-sm bg-card hover:bg-accent"
            >
                <FaArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex flex-col items-center justify-center min-h-screen px-6">

                <div className="flex items-center justify-center gap-3 mb-8">
                    <FaVideo className="h-6 w-6 text-primary" />
                    <h1 className="text-lg font-semibold tracking-wide text-primary">
                        RENDER PROJECT
                    </h1>
                </div>

                <Card className="w-full max-w-lg p-6 bg-card/80 backdrop-blur-md border shadow-xl rounded-2xl">

                    <div className="space-y-3">

                        <label
                            className={`group flex items-center justify-between gap-4 border-2 border-dashed rounded-lg px-5 py-4 cursor-pointer transition-all
                            ${jsonFile
                                    ? 'border-green-500 bg-green-50'
                                    : 'border-border hover:border-primary hover:bg-accent/40'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <FaFileUpload
                                    className={`h-5 w-5 transition-colors
                                    ${jsonFile ? 'text-green-600' : 'text-muted-foreground group-hover:text-primary'}`}
                                />
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">
                                        {jsonFile ? jsonFile.name : 'Upload Project JSON'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        Drag & drop or click
                                    </span>
                                </div>
                            </div>

                            {jsonFile && (
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        removeJson()
                                    }}
                                    className="h-7 w-7 text-green-700 hover:text-red-500"
                                >
                                    <FaTimes className="h-3 w-3" />
                                </Button>
                            )}

                            <input
                                type="file"
                                accept=".json,application/json"
                                onChange={handleJsonChange}
                                className="hidden"
                            />
                        </label>

                        <label
                            className={`group flex items-center justify-between gap-4 border-2 border-dashed rounded-lg px-5 py-4 cursor-pointer transition-all
                            ${audioFile
                                    ? 'border-green-500 bg-green-50'
                                    : 'border-border hover:border-primary hover:bg-accent/40'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <FaMusic
                                    className={`h-5 w-5 transition-colors
                                    ${audioFile ? 'text-green-600' : 'text-muted-foreground group-hover:text-primary'}`}
                                />
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">
                                        {audioFile ? audioFile.name : 'Optional Background Audio'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        MP3, WAV, etc.
                                    </span>
                                </div>
                            </div>

                            {audioFile && (
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        removeAudio()
                                    }}
                                    className="h-7 w-7 text-green-700 hover:text-red-500"
                                >
                                    <FaTimes className="h-3 w-3" />
                                </Button>
                            )}

                            <input
                                type="file"
                                accept="audio/*"
                                onChange={handleAudioChange}
                                className="hidden"
                            />
                        </label>

                    </div>

                    <div className="mt-6">
                        <Button
                            size="lg"
                            disabled={!jsonFile}
                            onClick={handleExport}
                            className="w-full rounded-lg text-sm shadow-md hover:shadow-lg transition-all"
                        >
                            🚀 Export Video
                        </Button>
                    </div>

                </Card>

            </div>
        </div>
    )
}