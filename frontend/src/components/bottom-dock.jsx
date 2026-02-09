import { LuAudioLines } from "react-icons/lu"
import { RiMovie2AiLine } from "react-icons/ri";
import { Dock, DockIcon } from "@/components/ui/dock"
import { Link, useLocation } from 'react-router-dom'

export default function BottomDock() {
    const location = useLocation()

    const getIconClass = (paths) => {
        return location.pathname === paths ? "text-primary" : "text-muted-foreground"
    }

    return (
        <Dock className="fixed bottom-4 left-1/2 -translate-x-1/2 gap-4 z-999">
            <DockIcon>
                <Link to="/">
                    <img
                        alt="App Logo"
                        src="/logo.svg"
                        className="size-7"
                    />
                </Link>
            </DockIcon>
            <DockIcon>
                <Link to="/">
                    <RiMovie2AiLine size={24} className={getIconClass("/")} />
                </Link>
            </DockIcon>
            <DockIcon>
                <Link to="/transcript">
                    <LuAudioLines size={24} className={getIconClass("/transcript")} />
                </Link>
            </DockIcon>
        </Dock>
    )
}