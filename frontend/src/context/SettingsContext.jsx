import { createContext, useContext } from "react";
import { useState, useEffect } from "react";

const SettingsContext = createContext();

const SESSION_KEY_ID = "sb_global_session_key";
const INSTRUCTIONS_ID = "sb_global_instructions";

export const SettingsProvider = ({ children }) => {
    const [sessionKey, setSessionKey] = useState(() => localStorage.getItem(SESSION_KEY_ID) || "");
    const [instructions, setInstructions] = useState(() => localStorage.getItem(INSTRUCTIONS_ID) || "");

    useEffect(() => {
        localStorage.setItem(SESSION_KEY_ID, sessionKey);
    }, [sessionKey]);

    useEffect(() => {
        localStorage.setItem(INSTRUCTIONS_ID, instructions);
    }, [instructions]);

    return (
        <SettingsContext.Provider value={{ sessionKey, setSessionKey, instructions, setInstructions }}>
            {children}
        </SettingsContext.Provider>
    )
}

export const useSettings = () => useContext(SettingsContext);