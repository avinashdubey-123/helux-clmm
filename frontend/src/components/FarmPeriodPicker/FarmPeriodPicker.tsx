import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import calendarIcon from '../../assets/calendar.svg';
import './FarmPeriodPicker.css';

interface FarmPeriodPickerProps {
  startTime?: string; // 'YYYY-MM-DDTHH:mm'
  endTime?: string;
  onChange: (start: string, end: string) => void;
  className?: string;
  lockStartDate?: boolean;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function FarmPeriodPicker({ startTime, endTime, onChange, className = '', lockStartDate = false }: FarmPeriodPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Parse start time or default to now
  const initialStart = startTime ? new Date(startTime) : new Date();
  
  // Local state for the popup
  const [currentMonth, setCurrentMonth] = useState(initialStart.getMonth());
  const [currentYear, setCurrentYear] = useState(initialStart.getFullYear());
  
  const [tempDate, setTempDate] = useState<Date>(new Date(initialStart));
  const [tempHours, setTempHours] = useState(String(initialStart.getHours()).padStart(2, '0'));
  const [tempMinutes, setTempMinutes] = useState(String(initialStart.getMinutes()).padStart(2, '0'));
  
  // Calculate duration from props if exists
  const initialDuration = (startTime && endTime) 
    ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60 * 24)))
    : 7; // default 7 days
    
  const [duration, setDuration] = useState(String(initialDuration));

  useEffect(() => {
    if (isOpen) {
      const d = startTime ? new Date(startTime) : new Date();
      setTempDate(new Date(d));
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
      setTempHours(String(d.getHours()).padStart(2, '0'));
      setTempMinutes(String(d.getMinutes()).padStart(2, '0'));
      
      const calcDur = (startTime && endTime) 
        ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60 * 24)))
        : 7;
      setDuration(String(calcDur));
    }
  }, [isOpen, startTime, endTime]);

  const handlePrevMonth = () => {
    if (lockStartDate) return;
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (lockStartDate) return;
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const generateDays = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="fpp-day empty"></div>);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      const btnDate = new Date(currentYear, currentMonth, i);
      const isPast = btnDate.getTime() < today.getTime();
      const isSelected = tempDate.getDate() === i && 
                         tempDate.getMonth() === currentMonth && 
                         tempDate.getFullYear() === currentYear;
      
      days.push(
        <button 
          key={i} 
          className={`fpp-day ${isSelected ? 'selected' : ''} ${isPast || lockStartDate ? 'disabled' : ''}`}
          disabled={isPast || lockStartDate}
          style={isPast || lockStartDate ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
          onClick={(e) => {
            e.preventDefault();
            if (isPast || lockStartDate) return;
            const newDate = new Date(currentYear, currentMonth, i);
            
            let h = parseInt(tempHours, 10);
            let m = parseInt(tempMinutes, 10);
            
            const isClickingToday = newDate.getDate() === today.getDate() && 
                                    newDate.getMonth() === today.getMonth() && 
                                    newDate.getFullYear() === today.getFullYear();
                                    
            if (isClickingToday) {
               if (h < today.getHours()) {
                 h = today.getHours();
                 m = today.getMinutes();
               } else if (h === today.getHours() && m < today.getMinutes()) {
                 m = today.getMinutes();
               }
               setTempHours(String(h).padStart(2, '0'));
               setTempMinutes(String(m).padStart(2, '0'));
            }

            newDate.setHours(h);
            newDate.setMinutes(m);
            setTempDate(newDate);
          }}
        >
          {i}
        </button>
      );
    }
    return days;
  };

  // Calculate projected end date for the summary box
  const getProjectedEnd = () => {
    const start = new Date(tempDate);
    start.setHours(parseInt(tempHours || '0', 10));
    start.setMinutes(parseInt(tempMinutes || '0', 10));
    
    const d = parseInt(duration || '0', 10);
    const end = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
    return end;
  };

  const projectedEnd = getProjectedEnd();

  const handleConfirm = () => {
    const start = new Date(tempDate);
    start.setHours(parseInt(tempHours || '0', 10));
    start.setMinutes(parseInt(tempMinutes || '0', 10));
    
    let finalDuration = parseInt(duration || '0', 10);
    if (finalDuration < 7) return; // shouldn't happen due to disabled button, but safe-guard
    
    const end = new Date(start.getTime() + finalDuration * 24 * 60 * 60 * 1000);
    
    const tzOffset = start.getTimezoneOffset() * 60000;
    const startISO = (new Date(start.getTime() - tzOffset)).toISOString().slice(0, 16);
    const endISO = (new Date(end.getTime() - tzOffset)).toISOString().slice(0, 16);
    
    onChange(startISO, endISO);
    setIsOpen(false);
  };

  const formatDisplayValue = () => {
    if (!startTime || !endTime) return '';
    const sd = new Date(startTime);
    const ed = new Date(endTime);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return '';
    
    const format = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return `${format(sd)} - ${format(ed)}`;
  };

  const todayRender = new Date();
  const isSelectedToday = tempDate.getDate() === todayRender.getDate() && 
                          tempDate.getMonth() === todayRender.getMonth() && 
                          tempDate.getFullYear() === todayRender.getFullYear();
  const currentHour = todayRender.getHours();
  const currentMinute = todayRender.getMinutes();

  return (
    <div className={`fpp-container ${className}`}>
      <div 
        className="fpp-input-wrapper"
        onClick={() => setIsOpen(true)}
      >
        <input 
          type="text" 
          readOnly 
          className="fpp-input" 
          value={formatDisplayValue()} 
          placeholder="Select Farm Period"
        />
        <span className="fpp-icon">
          <img src={calendarIcon} alt="calendar" width="18" height="18" />
        </span>
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fpp-overlay">
          <div className="fpp-backdrop" onClick={() => setIsOpen(false)} />
          <div className="fpp-dropdown">
            <div className="fpp-header">
              <h3>Farm period</h3>
              <button className="fpp-close-btn" onClick={() => setIsOpen(false)}>✕</button>
            </div>
            
            <div className="fpp-body">
              {/* Left side: Calendar */}
              <div className="fpp-left">
                <div className="fpp-label">Start on</div>
                <div className="fpp-calendar-card">
                  <div className="fpp-cal-header">
                    <button className="fpp-cal-nav" onClick={(e) => { e.preventDefault(); handlePrevMonth(); }}>&lt;</button>
                    <div className="fpp-cal-month">{MONTHS[currentMonth]} {currentYear}</div>
                    <button className="fpp-cal-nav" onClick={(e) => { e.preventDefault(); handleNextMonth(); }}>&gt;</button>
                  </div>
                  
                  <div className="fpp-cal-days-header">
                    {DAYS.map(d => <div key={d}>{d}</div>)}
                  </div>
                  
                  <div className="fpp-cal-grid">
                    {generateDays()}
                  </div>
                </div>
              </div>
              
              {/* Right side: Time & Duration */}
              <div className="fpp-right">
                <div className="fpp-label">Start at {lockStartDate && <span style={{fontSize: '11px', color: '#ffb020'}}>(Locked)</span>}</div>
                <div className="fpp-time-row">
                  <div className="fpp-select-wrapper">
                    <select 
                      className="fpp-select" 
                      value={tempHours} 
                      disabled={lockStartDate}
                      onChange={e => {
                        const newHour = parseInt(e.target.value, 10);
                        setTempHours(e.target.value);
                        if (isSelectedToday && newHour === currentHour && parseInt(tempMinutes, 10) < currentMinute) {
                          setTempMinutes(String(currentMinute).padStart(2, '0'));
                        }
                      }}
                    >
                      {Array.from({ length: 24 }).map((_, i) => {
                        if (isSelectedToday && i < currentHour) return null;
                        const val = String(i).padStart(2, '0');
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                  </div>
                  <div className="fpp-select-wrapper">
                    <select 
                      className="fpp-select" 
                      value={tempMinutes} 
                      disabled={lockStartDate}
                      onChange={e => setTempMinutes(e.target.value)}
                    >
                      {Array.from({ length: 60 }).map((_, i) => {
                        if (isSelectedToday && parseInt(tempHours, 10) === currentHour && i < currentMinute) return null;
                        const val = String(i).padStart(2, '0');
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                  </div>
                </div>
                
                <div className="fpp-label" style={{ marginTop: '16px' }}>Duration (Days)</div>
                <input 
                  type="number" 
                  className={`fpp-duration-input ${parseInt(duration || '0', 10) < 7 || parseInt(duration || '0', 10) > 90 ? 'fpp-error' : ''}`}
                  value={duration} 
                  onChange={e => setDuration(e.target.value)}
                  min="7"
                  max="90"
                />
                
                <div className="fpp-summary-card">
                  <div className="fpp-summary-label">Farm will end at</div>
                  <div className="fpp-summary-date">
                    {String(projectedEnd.getDate()).padStart(2, '0')}/{String(projectedEnd.getMonth() + 1).padStart(2, '0')}/{projectedEnd.getFullYear()}
                  </div>
                  <div className="fpp-summary-time">
                    {String(projectedEnd.getHours()).padStart(2, '0')}:{String(projectedEnd.getMinutes()).padStart(2, '0')} (Local)
                  </div>
                </div>
              </div>
            </div>
            
            <div className="fpp-footer">
              <button className="fpp-btn-cancel" onClick={() => setIsOpen(false)}>Cancel</button>
              <button 
                className="fpp-btn-confirm" 
                onClick={handleConfirm}
                disabled={parseInt(duration || '0', 10) < 7 || parseInt(duration || '0', 10) > 90}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
