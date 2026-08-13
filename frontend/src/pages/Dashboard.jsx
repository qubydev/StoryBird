import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaPlus, FaTrash, FaFilm, FaClock, FaArrowRight } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createProject, deleteProject, listProjects, migrateLegacyProject } from '@/lib/storyboard-utils';
import GlobalSettingsDialog from '@/components/settings/GlobalSettingsDialog';
import toast from 'react-hot-toast';

const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(value));

export default function Dashboard() {
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [title, setTitle] = useState('');

    const refreshProjects = () => setProjects(listProjects());
    useEffect(() => {
        const loadProjects = async () => {
            await migrateLegacyProject();
            refreshProjects();
        };
        loadProjects();
    }, []);

    const handleCreate = (event) => {
        event.preventDefault();
        const project = createProject(title);
        setTitle('');
        navigate(`/project/${project.id}`);
    };

    const handleDelete = async (event, project) => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(`Delete “${project.title}”? This cannot be undone.`)) return;
        await deleteProject(project.id);
        refreshProjects();
        toast.success('Project deleted');
    };

    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-pink-50 px-5 py-10 sm:px-10">
            <div className="mx-auto max-w-6xl">
                <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-pink-500">
                            <FaFilm /> <span className="text-sm font-bold tracking-[0.2em]">ANIM BOARD</span>
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Your storyboard projects</h1>
                        <p className="mt-2 text-slate-500">Create, organise, and return to every video story in one place.</p>
                    </div>
                    <GlobalSettingsDialog />
                </header>

                <section className="mb-10 rounded-2xl border border-pink-100 bg-white p-5 shadow-sm sm:p-6">
                    <h2 className="text-lg font-semibold text-slate-800">Start a new project</h2>
                    <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <Input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Project name (for example, Mexican Cartel Story)"
                            className="h-11 flex-1"
                            maxLength={100}
                        />
                        <Button type="submit" className="h-11 bg-pink-500 px-5 text-white hover:bg-pink-600">
                            <FaPlus className="mr-2" /> Create project
                        </Button>
                    </form>
                </section>

                <section>
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-slate-800">Recent projects</h2>
                        <span className="text-sm text-slate-500">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>
                    </div>

                    {projects.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center">
                            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-pink-50 text-pink-500"><FaFilm /></div>
                            <h3 className="mt-4 font-semibold text-slate-800">No projects yet</h3>
                            <p className="mt-1 text-sm text-slate-500">Give your first storyboard a name and start creating.</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {projects.map((project) => (
                                <Link key={project.id} to={`/project/${project.id}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-md">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-500"><FaFilm /></div>
                                        <Button variant="ghost" size="icon" onClick={(event) => handleDelete(event, project)} className="size-8 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Delete project">
                                            <FaTrash className="size-3.5" />
                                        </Button>
                                    </div>
                                    <h3 className="mt-5 truncate text-lg font-semibold text-slate-800">{project.title}</h3>
                                    <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><FaClock /> Updated {formatDate(project.updatedAt)}</div>
                                    <div className="mt-5 flex items-center gap-2 text-sm font-medium text-pink-500">Open storyboard <FaArrowRight className="transition group-hover:translate-x-1" /></div>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
