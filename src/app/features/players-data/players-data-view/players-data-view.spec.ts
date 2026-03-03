import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlayersDataView } from './players-data-view';

describe('PlayersDataView', () => {
  let component: PlayersDataView;
  let fixture: ComponentFixture<PlayersDataView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayersDataView]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PlayersDataView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
