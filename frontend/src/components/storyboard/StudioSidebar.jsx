import React from 'react';
import { Link } from 'react-router-dom';
import { FaArrowLeft, FaFilm, FaFolderOpen, FaMagic, FaSlidersH } from 'react-icons/fa';
import FileMenu from './topbar/FileMenu';
import GeneratorControls from './topbar/GeneratorControls';
import { GlobalSettings } from './topbar/GlobalSettings';
import StatsDisplay from './topbar/StatsDisplay';

const StudioSidebar = () => (
    <aside className="studio-sidebar">
        <div className="studio-sidebar-brand">
            <Link to="/" className="studio-logo" aria-label="All projects"><img src="/logo.svg" alt="Anim Board" /></Link>
            <div><strong>AnimBoard</strong><span>Story studio</span></div>
        </div>

        <Link to="/" className="studio-back-link"><FaArrowLeft /> All projects</Link>

        <nav className="studio-nav" aria-label="Storyboard sections">
            <span className="studio-nav-label">Workspace</span>
            <a className="studio-nav-item studio-nav-current" href="#storyboard"><FaFilm /> Storyboard</a>
            <a className="studio-nav-item" href="#characters"><FaSlidersH /> Characters</a>
        </nav>

        <div className="studio-sidebar-stats"><StatsDisplay /></div>

        <section className="studio-sidebar-section">
            <span className="studio-nav-label"><FaFolderOpen /> Project</span>
            <div className="studio-sidebar-files"><FileMenu /></div>
        </section>
        <section className="studio-sidebar-section">
            <span className="studio-nav-label"><FaMagic /> AI tools</span>
            <div className="studio-sidebar-settings"><GlobalSettings /></div>
        </section>
        <section className="studio-sidebar-section studio-sidebar-generation">
            <span className="studio-nav-label"><FaMagic /> Generate</span>
            <GeneratorControls />
        </section>
        <p className="studio-sidebar-footer">AnimBoard Studio<br />Your work saves automatically.</p>
    </aside>
);

export default StudioSidebar;
